/**
 * Who owns the assignment being set up. Setup starts before sign-in (PRD, "Landing page"), so a
 * visitor gets a random draft-owner id in a cookie. Once they sign in, their drafts move to their
 * teacher account on the next request.
 */
import { Db, schema } from "@goblins/domain";
import { getCookie, setCookie } from "@tanstack/react-start/server";
import { and, eq, isNull } from "drizzle-orm";
import { Data, Effect, Schema } from "effect";
import { currentTeacher, signedInUserId, type Teacher } from "./teacher";

export type Owner =
  | { readonly _tag: "Teacher"; readonly teacher: Teacher }
  | { readonly _tag: "Draft"; readonly draftOwnerId: string };

const DRAFT_COOKIE = "gb_draft_owner";
const isUuid = Schema.is(Schema.UUID);

const draftOwnerId = Effect.sync(() => {
  const existing = getCookie(DRAFT_COOKIE);
  if (existing !== undefined && isUuid(existing)) return existing;
  const id = crypto.randomUUID();
  setCookie(DRAFT_COOKIE, id, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    secure: true,
    maxAge: 60 * 60 * 24 * 30,
  });
  return id;
});

export const currentOwner = Effect.gen(function* () {
  const userId = yield* signedInUserId;
  if (userId === null) {
    return { _tag: "Draft", draftOwnerId: yield* draftOwnerId } satisfies Owner;
  }
  const teacher = yield* currentTeacher;
  const draft = getCookie(DRAFT_COOKIE);
  if (draft !== undefined && isUuid(draft)) {
    const db = yield* Db;
    yield* db
      .update(schema.assignments)
      .set({ teacherId: teacher.id, draftOwnerId: null })
      .where(and(eq(schema.assignments.draftOwnerId, draft), isNull(schema.assignments.teacherId)));
  }
  return { _tag: "Teacher", teacher } satisfies Owner;
});

export class AssignmentNotFound extends Data.TaggedError("AssignmentNotFound") {}

/** The assignment, if the current owner owns it. */
export const ownedAssignment = (assignmentId: string) =>
  Effect.gen(function* () {
    if (!isUuid(assignmentId)) return yield* Effect.fail(new AssignmentNotFound());
    const owner = yield* currentOwner;
    const db = yield* Db;
    const [assignment] = yield* db
      .select()
      .from(schema.assignments)
      .where(
        and(
          eq(schema.assignments.id, assignmentId),
          owner._tag === "Teacher"
            ? eq(schema.assignments.teacherId, owner.teacher.id)
            : eq(schema.assignments.draftOwnerId, owner.draftOwnerId),
        ),
      );
    if (assignment === undefined) return yield* Effect.fail(new AssignmentNotFound());
    return { assignment, owner };
  });
