/**
 * Creating drafts. Kept apart from `fns.ts`, which may export only server functions: anything else
 * exported there is bundled into the browser with its server imports.
 */
import { Db, schema } from "@goblins/domain";
import { Effect, Option } from "effect";
import { templatePageUrls } from "../../setup/template-pages";
import { err, ok } from "../result";
import { markExtractionFailed, saveExtracted } from "./draft";
import { extractTemplate, extractWorksheet } from "./setup-ai";
import { currentViewer, ensureDraftOwner, type Viewer } from "./viewer";

export const owner = (viewer: Viewer) =>
  Effect.gen(function* () {
    if (Option.isSome(viewer.teacherId)) {
      return { teacherId: viewer.teacherId.value, draftOwnerId: null };
    }
    return { teacherId: null, draftOwnerId: yield* ensureDraftOwner };
  });

export const extractInBackground = (
  draftId: string,
  pages: ReadonlyArray<{ pageNumber: number; imageUrl: string }>,
) =>
  extractWorksheet(pages).pipe(
    Effect.flatMap((extracted) => saveExtracted(draftId, extracted)),
    Effect.catchTags({
      NotMath: (e) => markExtractionFailed(draftId, e.message),
      Unreadable: (e) => markExtractionFailed(draftId, e.message),
    }),
    Effect.catchAllCause((cause) =>
      Effect.logError("extraction failed", cause).pipe(
        Effect.zipRight(
          markExtractionFailed(
            draftId,
            "Something went wrong reading this worksheet. Try uploading it again.",
          ),
        ),
        Effect.orDie,
      ),
    ),
  );

/** Starts a draft from a template. No model call: the template's key becomes the rubric. */
export const startTemplateDraft = (templateId: string) =>
  Effect.gen(function* () {
    const extracted = extractTemplate(templateId);
    if (Option.isNone(extracted)) return err({ _tag: "UnknownTemplate" } as const);
    const viewer = yield* currentViewer;
    const db = yield* Db;
    const [assignment] = yield* db
      .insert(schema.assignments)
      .values({ ...(yield* owner(viewer)), templateId, extractionStatus: "extracting" })
      .returning({ id: schema.assignments.id });
    if (assignment === undefined) return yield* Effect.die("assignment insert returned no row");
    yield* db.insert(schema.worksheetPages).values(
      templatePageUrls(templateId).map((imageUrl, index) => ({
        assignmentId: assignment.id,
        pageNumber: index + 1,
        imageUrl,
      })),
    );
    yield* saveExtracted(assignment.id, extracted.value);
    return ok({ _tag: "Started", draftId: assignment.id } as const);
  });
