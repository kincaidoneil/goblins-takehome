/**
 * Who is looking at a draft. Setup needs no sign-in (PRD, "Landing page"): an anonymous visitor's
 * browser holds a random draft-owner id in an HTTP-only cookie, and drafts they start belong to
 * it. A signed-in teacher's drafts belong to their teacher row. At launch the teacher claims the
 * anonymous drafts (`claimDrafts`).
 *
 * The cookie is an unguessable UUID, so it is a bearer token on its own and needs no signature.
 */
import { auth } from "@clerk/tanstack-react-start/server";
import { Db, schema } from "@goblins/domain";
import { getCookie, setCookie } from "@tanstack/react-start/server";
import { eq } from "drizzle-orm";
import { Effect, Option, Schema } from "effect";

const COOKIE = "gb_draft_owner";
const isUuid = Schema.is(Schema.UUID);

export interface Viewer {
  readonly draftOwnerId: Option.Option<string>;
  readonly teacherId: Option.Option<string>;
}

/** The draft-owner id from this request's cookie, if any. */
const draftOwnerFromCookie = () => {
  const raw = getCookie(COOKIE);
  return raw !== undefined && isUuid(raw) ? Option.some(raw) : Option.none<string>();
};

/** The signed-in teacher's row id, without creating one: a teacher with no row owns nothing yet. */
const signedInTeacherId = Effect.gen(function* () {
  const { userId } = yield* Effect.promise(() => auth());
  if (userId === null) return Option.none<string>();
  const db = yield* Db;
  const [row] = yield* db
    .select({ id: schema.teachers.id })
    .from(schema.teachers)
    .where(eq(schema.teachers.clerkUserId, userId));
  return Option.fromNullable(row?.id);
});

export const currentViewer = Effect.gen(function* () {
  return {
    draftOwnerId: draftOwnerFromCookie(),
    teacherId: yield* signedInTeacherId,
  } satisfies Viewer;
});

/** The draft-owner id for this browser, setting the cookie on first use. */
export const ensureDraftOwner = Effect.sync(() => {
  const existing = draftOwnerFromCookie();
  if (Option.isSome(existing)) return existing.value;
  const id = crypto.randomUUID();
  setCookie(COOKIE, id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    // A teacher may start a draft at home and launch it at school days later.
    maxAge: 60 * 60 * 24 * 30,
  });
  return id;
});

/** Whether the viewer owns an assignment row. */
export const owns = (
  viewer: Viewer,
  assignment: { readonly teacherId: string | null; readonly draftOwnerId: string | null },
) =>
  (assignment.teacherId !== null && Option.contains(viewer.teacherId, assignment.teacherId)) ||
  (assignment.draftOwnerId !== null &&
    Option.contains(viewer.draftOwnerId, assignment.draftOwnerId));
