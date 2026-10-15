/**
 * Setup's server functions: start a draft (from an upload or a template), read it, edit it inline
 * or by chat, and launch it. Expected failures come back as `Err` values (see `server/result.ts`).
 */
import { Db, schema } from "@goblins/domain";
import { createServerFn } from "@tanstack/react-start";
import { waitUntil } from "@vercel/functions";
import { Effect, Option, Schema } from "effect";
import { err, ok } from "../result";
import { run } from "../runtime";
import { currentTeacher } from "../teacher";
import { type Draft, ensureEditable, loadDraft, ownedAssignment } from "./draft";
import { applyEdits, Edit } from "./edits";
import { claimDrafts, launchDraft } from "./launch";
import { editByChat } from "./setup-ai";
import { extractInBackground, owner, startTemplateDraft } from "./start";
import { storeFile } from "./storage";
import { currentViewer, type Viewer } from "./viewer";

/** The browser converts every upload to page images before sending (see `setup/upload.ts`). */
const MAX_PAGES = 10;
/** Under Vercel's 4.5 MB request body limit, with room for the form encoding. */
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
const PAGE_TYPES = ["image/jpeg", "image/png", "image/webp"];

/** Starts a draft from page images. Extraction runs after the response; the setup screen polls. */
export const startDraftFromUpload = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (!(data instanceof FormData)) throw new Error("expected form data");
    return data;
  })
  .handler(({ data }) =>
    run(
      Effect.gen(function* () {
        const files = data.getAll("page").filter((entry): entry is File => entry instanceof File);
        if (files.length === 0 || !files.every((file) => PAGE_TYPES.includes(file.type))) {
          return err({ _tag: "Rejected", reason: "unsupported" } as const);
        }
        if (files.length > MAX_PAGES) return err({ _tag: "Rejected", reason: "too-many" } as const);
        if (files.reduce((sum, file) => sum + file.size, 0) > MAX_UPLOAD_BYTES) {
          return err({ _tag: "Rejected", reason: "too-large" } as const);
        }

        const viewer = yield* currentViewer;
        const db = yield* Db;
        const [assignment] = yield* db
          .insert(schema.assignments)
          .values({ ...(yield* owner(viewer)), extractionStatus: "extracting" })
          .returning({ id: schema.assignments.id });
        if (assignment === undefined) return yield* Effect.die("assignment insert returned no row");

        const pages = yield* Effect.forEach(
          files,
          (file, index) =>
            storeFile(
              `worksheets/${assignment.id}/page-${index + 1}.${file.type.split("/")[1]}`,
              file,
              file.type,
            ).pipe(Effect.map((imageUrl) => ({ pageNumber: index + 1, imageUrl }))),
          { concurrency: 4 },
        );
        yield* db
          .insert(schema.worksheetPages)
          .values(pages.map((page) => ({ ...page, assignmentId: assignment.id })));

        waitUntil(run(extractInBackground(assignment.id, pages)));
        return ok({ _tag: "Started", draftId: assignment.id } as const);
      }).pipe(
        Effect.catchTag("StorageFailed", (e) =>
          Effect.logError("page upload failed", e.cause).pipe(
            Effect.as(err({ _tag: "Rejected", reason: "upload-failed" } as const)),
          ),
        ),
      ),
    ),
  );

export const startDraftFromTemplate = createServerFn({ method: "POST" })
  .validator(Schema.standardSchemaV1(Schema.Struct({ templateId: Schema.String })))
  .handler(({ data }) => run(startTemplateDraft(data.templateId)));

const DraftInput = Schema.Struct({ draftId: Schema.UUID });

const notFound = () => Effect.succeed(err({ _tag: "DraftNotFound" } as const));
const locked = (e: { readonly sessionId: string }) =>
  Effect.succeed(err({ _tag: "DraftLocked", sessionId: e.sessionId } as const));

export const getDraft = createServerFn({ method: "GET" })
  .validator(Schema.standardSchemaV1(DraftInput))
  .handler(({ data }) =>
    run(
      Effect.gen(function* () {
        const viewer = yield* currentViewer;
        return ok(yield* loadDraft(viewer, data.draftId));
      }).pipe(Effect.catchTag("DraftNotFound", notFound)),
    ),
  );

export const editDraft = createServerFn({ method: "POST" })
  .validator(
    Schema.standardSchemaV1(
      Schema.Struct({
        draftId: Schema.UUID,
        edits: Schema.Array(Edit).pipe(Schema.maxItems(50)),
      }),
    ),
  )
  .handler(({ data }) =>
    run(
      Effect.gen(function* () {
        const viewer = yield* currentViewer;
        yield* ownedAssignment(viewer, data.draftId);
        yield* ensureEditable(data.draftId);
        yield* applyEdits(data.draftId, data.edits);
        return ok(yield* loadDraft(viewer, data.draftId));
      }).pipe(
        Effect.catchTags({
          DraftNotFound: notFound,
          DraftLocked: locked,
          EditRejected: (e) =>
            Effect.succeed(err({ _tag: "EditRejected", reason: e.reason } as const)),
        }),
      ),
    ),
  );

/** Which problems an edit batch touched, so the screen can point them out. */
const touched = (before: Draft, after: Draft): ReadonlyArray<string> =>
  after.problems
    .filter((problem) => {
      const old = before.problems.find((p) => p.id === problem.id);
      return old === undefined || JSON.stringify(old) !== JSON.stringify(problem);
    })
    .map((problem) => problem.id);

export const sendChatMessage = createServerFn({ method: "POST" })
  .validator(
    Schema.standardSchemaV1(
      Schema.Struct({
        draftId: Schema.UUID,
        message: Schema.Trim.pipe(Schema.nonEmptyString(), Schema.maxLength(2000)),
      }),
    ),
  )
  .handler(({ data }) =>
    run(
      Effect.gen(function* () {
        const viewer = yield* currentViewer;
        const before = yield* loadDraft(viewer, data.draftId);
        yield* ensureEditable(data.draftId);
        const db = yield* Db;
        yield* db
          .insert(schema.assignmentChatMessages)
          .values({ assignmentId: data.draftId, role: "teacher", content: data.message });
        const { reply, edits } = yield* editByChat(before, data.message);
        // A reply whose edits don't apply is the model's mistake, not the teacher's: say so.
        const applied = yield* applyEdits(data.draftId, edits).pipe(
          Effect.as(reply),
          Effect.catchTag("EditRejected", () =>
            Effect.succeed(
              "I couldn't make that change. Try saying it another way, or edit the card directly.",
            ),
          ),
        );
        yield* db
          .insert(schema.assignmentChatMessages)
          .values({ assignmentId: data.draftId, role: "assistant", content: applied });
        const after = yield* loadDraft(viewer, data.draftId);
        return ok({ draft: after, changed: touched(before, after) });
      }).pipe(Effect.catchTags({ DraftNotFound: notFound, DraftLocked: locked })),
    ),
  );

export const launch = createServerFn({ method: "POST" })
  .validator(
    Schema.standardSchemaV1(
      Schema.Struct({
        draftId: Schema.UUID,
        timeLimitMinutes: Schema.NullOr(Schema.Int.pipe(Schema.between(1, 240))),
      }),
    ),
  )
  .handler(({ data }) =>
    run(
      Effect.gen(function* () {
        const teacher = yield* currentTeacher;
        const viewer = yield* currentViewer;
        if (Option.isSome(viewer.draftOwnerId)) {
          yield* claimDrafts(viewer.draftOwnerId.value, teacher.id);
        }
        const signedIn: Viewer = {
          draftOwnerId: Option.none(),
          teacherId: Option.some(teacher.id),
        };
        const session = yield* launchDraft({
          viewer: signedIn,
          teacherId: teacher.id,
          draftId: data.draftId,
          timeLimitMinutes: data.timeLimitMinutes,
        });
        return ok({ sessionId: session.id, joinCode: session.joinCode });
      }).pipe(
        Effect.catchTags({
          NotSignedIn: () => Effect.succeed(err({ _tag: "NotSignedIn" } as const)),
          DraftNotFound: notFound,
          // Launched already, e.g. a second click: go to that session.
          DraftLocked: (e) => Effect.succeed(ok({ sessionId: e.sessionId, joinCode: null })),
          NotLaunchable: (e) =>
            Effect.succeed(
              err({ _tag: "NotLaunchable", reason: e.reason, label: e.label ?? null } as const),
            ),
        }),
      ),
    ),
  );
