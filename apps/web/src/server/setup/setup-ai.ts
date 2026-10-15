/**
 * The two model-backed steps of setup, behind one seam: reading worksheet pages into problems, and
 * turning a chat message into edits. With `MODEL_CLIENT=openrouter` they call the AI-quality
 * stream's `Extract` and `Chat` (packages/grader/src/ai) through a call-logged OpenRouter client.
 * Otherwise stubs stand in, since the mock model only answers grading calls: uploads extract as a
 * template and the chat understands a few phrasings, so E2E and local work cost nothing.
 */
import type { Db } from "@goblins/domain";
import { CallLog, Chat, Extract, OpenRouter } from "@goblins/grader";
import { getTemplate, templates } from "@goblins/templates";
import { Array as Arr, Data, Duration, Effect, Either, Layer, Option } from "effect";
import { toAppEdits, toSetupProblems } from "./chat-edits";
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

const realModel = () => process.env.MODEL_CLIENT === "openrouter";

/** OpenRouter with every call written to `model_calls`. Needs the database for the log. */
const loggedOpenRouter = CallLog.withCallLog("openrouter").pipe(
  Layer.provide(Layer.merge(OpenRouter.layer, CallLog.postgres)),
);

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
        rubric: [first, ...rest],
        dependsOn: [...problem.dependsOn],
      });
};

/** Reads uploaded pages into problems. */
export const extractWorksheet = (
  draftId: string,
  pages: ReadonlyArray<PageImage>,
): Effect.Effect<Extracted, NotMath | Unreadable, Db> =>
  realModel() ? extractWithModel(draftId, pages) : extractStub(pages);

const extractWithModel = (draftId: string, pages: ReadonlyArray<PageImage>) =>
  Effect.gen(function* () {
    const result = yield* Extract.extractWorksheet(
      pages.map((page) => page.imageUrl),
      { purpose: "extract", subjectId: draftId },
    ).pipe(
      Effect.provide(loggedOpenRouter),
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
  realModel() ? chatWithModel(draft, message) : Effect.succeed(stubChat(draft, message));

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
    ).pipe(Effect.provide(loggedOpenRouter), Effect.either);
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
