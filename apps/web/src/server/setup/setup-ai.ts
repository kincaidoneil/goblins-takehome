/**
 * The two model-backed steps of setup, behind one seam: reading worksheet pages into problems, and
 * turning a chat message into edits. With `MODEL_CLIENT=openrouter` they call the AI-quality
 * stream's `Extract` and `Chat` (packages/grader/src/ai) through a call-logged OpenRouter client.
 * Otherwise stubs stand in, since the mock model only answers grading calls: uploads extract as a
 * template and the chat understands a few phrasings, so E2E and local work cost nothing.
 */
import { DatabaseLive, type Db } from "@goblins/domain";
import { CallLog, Chat, Extract, ModelClient, OpenRouter } from "@goblins/grader";
import { getTemplate, templates } from "@goblins/templates";
import {
  Array as Arr,
  Data,
  Duration,
  Effect,
  Either,
  Layer,
  ManagedRuntime,
  Option,
} from "effect";
import { cleanRubric, toAppEdits, toSetupProblems } from "./chat-edits";
import { stubChat } from "./chat-stub";
import type { Draft } from "./draft";
import type { Edit } from "./edits";
import type { Extracted, ExtractedProblem } from "./extracted";
import { extractedFromTemplate } from "./from-template";

export interface PageImage {
  readonly pageNumber: number;
  readonly imageUrl: string;
}

/** Why a worksheet could not be set up. `message` is shown to the teacher as is. */
export class NotMath extends Data.TaggedError("NotMath")<{ readonly message: string }> {}
export class Unreadable extends Data.TaggedError("Unreadable")<{ readonly message: string }> {}

export interface ChatReply {
  readonly reply: string;
  readonly edits: ReadonlyArray<Edit>;
}

/**
 * Which model setup uses. Unset means the mock; any value other than `mock` or `openrouter` is a
 * misconfiguration, and setup refuses rather than quietly using the stubs.
 */
const modelMode = (): "mock" | "openrouter" | "invalid" => {
  const value = process.env.MODEL_CLIENT ?? "mock";
  return value === "mock" || value === "openrouter" ? value : "invalid";
};

/**
 * OpenRouter with every call written to `model_calls`, built once per server instance so every
 * setup call shares one spend guard (`MODEL_SPEND_CAP_USD`).
 */
const openRouterRuntime = ManagedRuntime.make(
  CallLog.withCallLog("openrouter").pipe(
    Layer.provide(Layer.merge(OpenRouter.layer, CallLog.postgres)),
    Layer.provide(DatabaseLive),
  ),
);

const withOpenRouter = <A, E>(effect: Effect.Effect<A, E, ModelClient>) =>
  Effect.flatMap(
    Effect.promise(() => openRouterRuntime.runPromise(ModelClient)),
    (client) => Effect.provideService(effect, ModelClient, client),
  );

const MISCONFIGURED = "Reading worksheets isn't available right now. Start from a template.";

/** What a model can fetch: https or data: URLs. Older template drafts stored app-relative paths. */
const fetchable = (url: string) => url.startsWith("https://") || url.startsWith("data:");

const COULD_NOT_READ =
  "Something went wrong reading this worksheet. Try uploading it again, or start from a template.";

const fromModel = (problem: Extract.ExtractedProblem): Option.Option<ExtractedProblem> => {
  const [first, ...rest] = problem.rubric;
  return first === undefined
    ? Option.none()
    : Option.some({
        label: problem.label,
        text: problem.text,
        answerKey: problem.answerKey,
        diagramDescription: problem.diagramDescription,
        pageNumbers: [...problem.pageNumbers],
        gradingNotes: problem.gradingNotes,
        rubric: cleanRubric([first, ...rest]),
        dependsOn: [...problem.dependsOn],
      });
};

/** Reads uploaded pages into problems. */
export const extractWorksheet = (
  draftId: string,
  pages: ReadonlyArray<PageImage>,
): Effect.Effect<Extracted, NotMath | Unreadable, Db> =>
  Effect.suspend(() => {
    switch (modelMode()) {
      case "openrouter":
        return extractWithModel(draftId, pages);
      case "mock":
        return extractStub(pages);
      case "invalid":
        return Effect.logError("MODEL_CLIENT must be mock or openrouter").pipe(
          Effect.zipRight(Effect.fail(new Unreadable({ message: MISCONFIGURED }))),
        );
    }
  });

const extractWithModel = (draftId: string, pages: ReadonlyArray<PageImage>) =>
  Effect.gen(function* () {
    const result = yield* Extract.extractWorksheet(
      pages.map((page) => page.imageUrl),
      { purpose: "extract", subjectId: draftId },
    ).pipe(
      withOpenRouter,
      Effect.catchAll((error) =>
        Effect.logError("extraction call failed", error).pipe(
          Effect.zipRight(Effect.fail(new Unreadable({ message: COULD_NOT_READ }))),
        ),
      ),
    );
    switch (result.extraction._tag) {
      case "NotMath":
        return yield* Effect.fail(new NotMath({ message: result.extraction.message }));
      case "Unreadable":
        return yield* Effect.fail(new Unreadable({ message: result.extraction.message }));
      case "Worksheet": {
        const problems = Arr.filterMap(result.extraction.problems, fromModel);
        if (!Arr.isNonEmptyReadonlyArray(problems)) {
          return yield* Effect.fail(
            new Unreadable({
              message:
                "We couldn't find any problems on this worksheet. Try a clearer photo, or start from a template.",
            }),
          );
        }
        // The model doesn't name the worksheet; the teacher names it before launch.
        return { title: "", problems } satisfies Extracted;
      }
    }
  });

/**
 * With the mock model: waits a few seconds (so the progress screen is exercised) and returns the
 * template whose page count is closest, so the rest of setup can be tried on any upload.
 */
const extractStub = (pages: ReadonlyArray<PageImage>) =>
  Effect.gen(function* () {
    yield* Effect.sleep(Duration.seconds(4));
    const closest = [...templates].sort(
      (a, b) =>
        Math.abs(a.files.pages.length - pages.length) -
        Math.abs(b.files.pages.length - pages.length),
    )[0];
    return extractedFromTemplate(closest ?? templates[0]);
  });

export const extractTemplate = (templateId: string) =>
  getTemplate(templateId).pipe(Option.map(extractedFromTemplate));

/** Turns a chat message into edits and a reply. The model's failures become a reply, not an error. */
export const editByChat = (draft: Draft, message: string): Effect.Effect<ChatReply, never, Db> =>
  Effect.suspend(() => {
    switch (modelMode()) {
      case "openrouter":
        return chatWithModel(draft, message);
      case "mock":
        return Effect.succeed(stubChat(draft, message));
      case "invalid":
        return Effect.logError("MODEL_CLIENT must be mock or openrouter").pipe(
          Effect.as({
            reply: "The chat isn't available right now. Edit the problems directly.",
            edits: [],
          }),
        );
    }
  });

const COULD_NOT_CHANGE =
  "I couldn't make that change. Try saying it another way, or edit the problem directly.";

const chatWithModel = (draft: Draft, message: string) =>
  Effect.gen(function* () {
    const problems = toSetupProblems(draft);
    const result = yield* Chat.chatEdit(
      {
        problems,
        pageImageUrls: draft.pages.map((page) => page.imageUrl).filter(fetchable),
        history: draft.chat.map((turn) => ({ role: turn.role, content: turn.content })),
        message,
      },
      { purpose: "rubric-chat", subjectId: draft.id },
    ).pipe(withOpenRouter, Effect.either);
    if (Either.isLeft(result)) {
      yield* Effect.logError("chat call failed", result.left);
      return {
        reply: "I couldn't reach the model just now. Try again in a moment.",
        edits: [],
      } satisfies ChatReply;
    }
    // Check the whole batch before any of it touches the database.
    if (Either.isLeft(Chat.applyEdits(problems, result.right.edits))) {
      return { reply: COULD_NOT_CHANGE, edits: [] } satisfies ChatReply;
    }
    return Option.match(toAppEdits(draft, result.right.edits), {
      onNone: (): ChatReply => ({ reply: COULD_NOT_CHANGE, edits: [] }),
      onSome: (edits): ChatReply => ({ reply: result.right.reply, edits }),
    });
  });
