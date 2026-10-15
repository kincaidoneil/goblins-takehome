/**
 * Who is looking at a draft. Setup needs no sign-in (PRD, "Landing page"): an anonymous visitor's
 * browser holds a random draft-owner id in an HTTP-only cookie, and drafts they start belong to
 * it. A signed-in teacher's drafts belong to their teacher row. At launch the teacher claims the
 * anonymous drafts (`claimDrafts`).
 *
 * The cookie is an unguessable UUID, so it is a bearer token on its own and needs no signature.
 */
import { Db, schema } from "@goblins/domain";
import { getCookie, setCookie } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";
import { signedInUserId } from "../teacher";

const COOKIE = "gb_draft_owner";
const isUuid = Schema.is(Schema.UUID);

export interface Viewer {
  readonly draftOwnerId: Option.Option<string>;
  readonly teacherId: Option.Option<string>;
}

// Cookies are read and set outside Effect fibers, in the server function's own async context:
// TanStack's request context lives in AsyncLocalStorage, which a fiber may not carry.

/** The draft-owner id from this request's cookie, if any. Call outside an Effect. */
export const readDraftOwner = (): Option.Option<string> => {
  const raw = getCookie(COOKIE);
  return raw !== undefined && isUuid(raw) ? Option.some(raw) : Option.none<string>();
};

export interface DraftOwner {
  readonly id: string;
  /** No cookie yet: `saveDraftOwner` sets it after the draft is created. */
  readonly isNew: boolean;
}

/** This browser's draft-owner id, or a fresh one. Call outside an Effect. */
export const draftOwnerForRequest = (): DraftOwner =>
  Option.match(readDraftOwner(), {
    onSome: (id) => ({ id, isNew: false }),
    onNone: () => ({ id: crypto.randomUUID(), isNew: true }),
  });

/** Sets the cookie for a fresh draft-owner id. Call outside an Effect, after the write. */
export const saveDraftOwner = (owner: DraftOwner) => {
  if (!owner.isNew) return;
  setCookie(COOKIE, owner.id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    // A teacher may start a draft at home and launch it at school days later.
    maxAge: 60 * 60 * 24 * 30,
  });
};

/** The signed-in teacher's row id, without creating one: a teacher with no row owns nothing yet. */
const signedInTeacherId = Effect.gen(function* () {
  const userId = yield* signedInUserId;
  if (userId === null) return Option.none<string>();
  const db = yield* Db;
  const [row] = yield* db
    .select({ id: schema.teachers.id })
    .from(schema.teachers)
    .where(eq(schema.teachers.clerkUserId, userId));
  return Option.fromNullable(row?.id);
});

/** The viewer for a draft-owner id read with `readDraftOwner`. */
export const viewerFor = (draftOwnerId: Option.Option<string>) =>
  Effect.map(signedInTeacherId, (teacherId): Viewer => ({ draftOwnerId, teacherId }));

/** Who a new draft belongs to: the signed-in teacher, else this browser's draft owner. */
export const newDraftOwner = (viewer: Viewer, draftOwnerId: string) =>
  Option.match(viewer.teacherId, {
    onSome: (teacherId) => ({ teacherId, draftOwnerId: null }),
    onNone: () => ({ teacherId: null, draftOwnerId }),
  });

/** Whether the viewer owns an assignment row. */
export const owns = (
  viewer: Viewer,
  assignment: { readonly teacherId: string | null; readonly draftOwnerId: string | null },
) =>
  (assignment.teacherId !== null && Option.contains(viewer.teacherId, assignment.teacherId)) ||
  (assignment.draftOwnerId !== null &&
    Option.contains(viewer.draftOwnerId, assignment.draftOwnerId));
