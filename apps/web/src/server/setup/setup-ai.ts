/**
 * The two model-backed steps of setup, behind one seam: reading worksheet pages into problems, and
 * turning a chat message into edits. The AI-quality stream owns the real versions (in
 * packages/grader/src/ai); until they land, these stubs keep templates and the chat working end to
 * end with no model call.
 */
import { getTemplate, templates } from "@goblins/templates";
import { Data, Duration, Effect, Option } from "effect";
import { stubChat } from "./chat-stub";
import type { Draft } from "./draft";
import type { Edit } from "./edits";
import type { Extracted } from "./extracted";
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

const modelClient = () => process.env.MODEL_CLIENT ?? "mock";

/**
 * Reads uploaded pages into problems. With the mock model, it waits a few seconds (so the progress
 * screen is exercised) and returns the template whose page count is closest, so the rest of setup
 * can be tried locally on any upload.
 */
export const extractWorksheet = (
  pages: ReadonlyArray<PageImage>,
): Effect.Effect<Extracted, NotMath | Unreadable> =>
  Effect.gen(function* () {
    if (modelClient() !== "mock") {
      return yield* Effect.fail(
        new Unreadable({
          message:
            "Reading uploaded worksheets isn't switched on yet. Start from a template to try the rest.",
        }),
      );
    }
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

export const editByChat = (draft: Draft, message: string): Effect.Effect<ChatReply> =>
  Effect.succeed(stubChat(draft, message));
