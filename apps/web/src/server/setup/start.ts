/**
 * Creating drafts. Kept apart from `fns.ts`, which may export only server functions: anything else
 * exported there is bundled into the browser with its server imports.
 */
import { Db, SqlClient, schema } from "@goblins/domain";
import { waitUntil } from "@vercel/functions";
import { Array as Arr, Effect, Option } from "effect";
import { templatePageUrls } from "../../setup/template-pages";
import { err, ok } from "../result";
import { run } from "../runtime";
import { markExtractionFailed, saveExtracted } from "./draft";
import { extractTemplate, extractWorksheet } from "./setup-ai";
import { deleteStored, storeFile } from "./storage";
import { newDraftOwner, viewerFor } from "./viewer";

export const extractInBackground = (
  draftId: string,
  pages: ReadonlyArray<{ pageNumber: number; imageUrl: string }>,
) =>
  extractWorksheet(draftId, pages).pipe(
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
/** Starts a template draft owned by the teacher, or else by `draftOwnerId` (see `viewer.ts`). */
export const startTemplateDraft = (templateId: string, draftOwnerId: string) =>
  Effect.gen(function* () {
    const extracted = extractTemplate(templateId);
    if (Option.isNone(extracted)) return err({ _tag: "UnknownTemplate" } as const);
    const viewer = yield* viewerFor(Option.some(draftOwnerId));
    const db = yield* Db;
    const [assignment] = yield* db
      .insert(schema.assignments)
      .values({
        ...newDraftOwner(viewer, draftOwnerId),
        templateId,
        extractionStatus: "extracting",
      })
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

/** The browser converts every upload to page images before sending (see `setup/upload.ts`). */
const MAX_PAGES = 10;
/** Under Vercel's 4.5 MB request body limit, with room for the form encoding. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const PAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

const rejected = (reason: "unsupported" | "too-many" | "too-large" | "upload-failed") =>
  err({ _tag: "Rejected", reason } as const);

/**
 * Starts a draft from page images: stores every page first, then writes the draft and its pages in
 * one transaction, so a failed upload leaves no draft behind. Extraction runs after the response.
 */
export const startUploadDraft = (files: ReadonlyArray<File>, draftOwnerId: string) =>
  Effect.gen(function* () {
    if (files.length === 0 || !files.every((file) => PAGE_TYPES.includes(file.type))) {
      return rejected("unsupported");
    }
    if (files.length > MAX_PAGES) return rejected("too-many");
    if (files.reduce((sum, file) => sum + file.size, 0) > MAX_UPLOAD_BYTES) {
      return rejected("too-large");
    }

    const draftId = crypto.randomUUID();
    const stored = yield* Effect.forEach(
      files,
      (file, index) =>
        storeFile(
          `worksheets/${draftId}/page-${index + 1}.${file.type.split("/")[1]}`,
          file,
          file.type,
        ).pipe(Effect.either),
      { concurrency: 4 },
    );
    const [failures, urls] = Arr.partitionMap(stored, (result) => result);
    if (failures.length > 0) {
      yield* Effect.logError("page upload failed", failures[0]?.cause);
      yield* deleteStored(urls);
      return rejected("upload-failed");
    }
    const pages = urls.map((imageUrl, index) => ({ pageNumber: index + 1, imageUrl }));

    const viewer = yield* viewerFor(Option.some(draftOwnerId));
    const db = yield* Db;
    const sql = yield* SqlClient;
    yield* sql
      .withTransaction(
        Effect.gen(function* () {
          yield* db.insert(schema.assignments).values({
            id: draftId,
            ...newDraftOwner(viewer, draftOwnerId),
            extractionStatus: "extracting",
          });
          yield* db
            .insert(schema.worksheetPages)
            .values(pages.map((page) => ({ ...page, assignmentId: draftId })));
        }),
      )
      .pipe(Effect.tapError(() => deleteStored(urls)));

    yield* Effect.sync(() => waitUntil(run(extractInBackground(draftId, pages))));
    return ok({ _tag: "Started", draftId } as const);
  });
