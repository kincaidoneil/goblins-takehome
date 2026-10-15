/**
 * Setup's server functions: start a draft (from an upload or a template), read it, edit it inline
 * or by chat, and launch it. Expected failures come back as `Err` values (see `server/result.ts`).
 */
import { Db, schema } from "@goblins/domain";
import { createServerFn } from "@tanstack/react-start";
import { getRequestIP, getRequestUrl } from "@tanstack/react-start/server";
import { Effect, Option, Schema } from "effect";
import { err, ok } from "../result";
import { run } from "../runtime";
import { currentTeacher, signedInUserId } from "../teacher";
import { type Draft, ensureEditable, loadDraft, ownedAssignment, whileEditable } from "./draft";
import { applyEdits, Edit } from "./edits";
import { claimDrafts, launchDraft } from "./launch";
import { CHAT_MESSAGES_PER_DRAFT, callerKeys, takeToken } from "./limits";
import { editByChat, modelMode } from "./setup-ai";
import { startTemplateDraft, startUploadDraft } from "./start";
import {
  draftOwnerForRequest,
  readDraftOwner,
  saveDraftOwner,
  type Viewer,
  viewerFor,
} from "./viewer";

/** Starts a draft from page images. Extraction runs after the response; the setup screen polls. */
export const startDraftFromUpload = createServerFn({ method: "POST" })
  .validator((data: unknown) => {
    if (!(data instanceof FormData)) throw new Error("expected form data");
    return data;
  })
  .handler(async ({ data }) => {
    const files = data.getAll("page").filter((entry): entry is File => entry instanceof File);
    const owner = draftOwnerForRequest();
    const result = await run(startUploadDraft(files, owner.id, requestIp()));
    if (result._tag === "Ok") saveDraftOwner(owner);
    return result;
  });

export const startDraftFromTemplate = createServerFn({ method: "POST" })
  .validator(Schema.standardSchemaV1(Schema.Struct({ templateId: Schema.String })))
  .handler(async ({ data }) => {
    const owner = draftOwnerForRequest();
    const result = await run(startTemplateDraft(data.templateId, owner.id, getRequestUrl().origin));
    if (result._tag === "Ok") saveDraftOwner(owner);
    return result;
  });

const DraftInput = Schema.Struct({ draftId: Schema.UUID });

const notFound = () => Effect.succeed(err({ _tag: "DraftNotFound" } as const));
const locked = (e: { readonly sessionId: string }) =>
  Effect.succeed(err({ _tag: "DraftLocked", sessionId: e.sessionId } as const));

export const getDraft = createServerFn({ method: "GET" })
  .validator(Schema.standardSchemaV1(DraftInput))
  .handler(({ data }) => {
    const draftOwnerId = readDraftOwner();
    return run(
      Effect.gen(function* () {
        const viewer = yield* viewerFor(draftOwnerId);
        const draft = yield* loadDraft(viewer, data.draftId);
        // From the server, so local sign-in mode (`AUTH_MODE=local`) counts as signed in.
        const signedIn = (yield* signedInUserId) !== null;
        return ok({ draft, signedIn });
      }).pipe(Effect.catchTag("DraftNotFound", notFound)),
    );
  });

export const editDraft = createServerFn({ method: "POST" })
  .validator(
    Schema.standardSchemaV1(
      Schema.Struct({
        draftId: Schema.UUID,
        edits: Schema.Array(Edit).pipe(Schema.maxItems(50)),
      }),
    ),
  )
  .handler(({ data }) => {
    const draftOwnerId = readDraftOwner();
    return run(
      Effect.gen(function* () {
        const viewer = yield* viewerFor(draftOwnerId);
        yield* ownedAssignment(viewer, data.draftId);
        yield* whileEditable(data.draftId, applyEdits(data.draftId, data.edits));
        return ok(yield* loadDraft(viewer, data.draftId));
      }).pipe(
        Effect.catchTags({
          DraftNotFound: notFound,
          DraftLocked: locked,
          EditRejected: (e) =>
            Effect.succeed(err({ _tag: "EditRejected", reason: e.reason } as const)),
        }),
      ),
    );
  });

/** The caller's IP, read in the handler's own context (never inside an effect). */
const requestIp = (): string | undefined => getRequestIP({ xForwardedFor: true }) ?? undefined;

const LIMIT_REPLIES = {
  perDraft:
    "This assignment has reached its chat limit. You can still edit any problem directly by clicking it.",
  hourly:
    "That's a lot of requests in the last hour. Try again later, or edit the problem directly.",
} as const;

/**
 * The chat, within its limits: messages per draft always, and an hourly rate per IP and owner when
 * the real model is in use (the mock costs nothing).
 */
const chatWithinLimits = (draft: Draft, message: string, viewer: Viewer, ip: string | undefined) =>
  Effect.gen(function* () {
    const sent = draft.chat.filter((turn) => turn.role === "teacher").length;
    if (sent >= CHAT_MESSAGES_PER_DRAFT) return { reply: LIMIT_REPLIES.perDraft, edits: [] };
    if (modelMode() === "openrouter") {
      const owner = Option.getOrElse(
        Option.orElse(viewer.teacherId, () => viewer.draftOwnerId),
        () => draft.id,
      );
      const limited = yield* takeToken("chat", callerKeys(ip, owner)).pipe(
        Effect.as(false),
        Effect.catchTag("RateLimited", () => Effect.succeed(true)),
      );
      if (limited) return { reply: LIMIT_REPLIES.hourly, edits: [] };
    }
    return yield* editByChat(draft, message);
  });

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
  .handler(({ data }) => {
    const draftOwnerId = readDraftOwner();
    const ip = requestIp();
    return run(
      Effect.gen(function* () {
        const viewer = yield* viewerFor(draftOwnerId);
        const before = yield* loadDraft(viewer, data.draftId);
        yield* ensureEditable(data.draftId);
        const db = yield* Db;
        yield* db
          .insert(schema.assignmentChatMessages)
          .values({ assignmentId: data.draftId, role: "teacher", content: data.message });
        const { reply, edits } = yield* chatWithinLimits(before, data.message, viewer, ip);
        // A reply whose edits don't apply is the model's mistake, not the teacher's: say so.
        const applied = yield* whileEditable(data.draftId, applyEdits(data.draftId, edits)).pipe(
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
    );
  });

export const launch = createServerFn({ method: "POST" })
  .validator(
    Schema.standardSchemaV1(
      Schema.Struct({
        draftId: Schema.UUID,
        timeLimitMinutes: Schema.NullOr(Schema.Int.pipe(Schema.between(1, 240))),
      }),
    ),
  )
  .handler(({ data }) => {
    const draftOwnerId = readDraftOwner();
    return run(
      Effect.gen(function* () {
        const teacher = yield* currentTeacher;
        const viewer = yield* viewerFor(draftOwnerId);
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
    );
  });
