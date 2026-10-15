/**
 * Server functions for the class report and its share link.
 */
import { randomBytes } from "node:crypto";
import { Db, schema } from "@goblins/domain";
import { layer as mockModel } from "@goblins/mock-model";
import { createServerFn } from "@tanstack/react-start";
import { and, eq, isNull } from "drizzle-orm";
import { Effect, Schema } from "effect";
import { anonymize, buildReport } from "../../report/model";
import { err, ok } from "../result";
import { run } from "../runtime";
import { ownedSession, reportHeader, reportInput, reportProblems, sharedSession } from "./data";
import { mistakesFor } from "./mistakes";

/**
 * The model the grouping call uses. The mock until the app's runtime provides the shared,
 * call-logged ModelClient; then this goes away and real calls follow `MODEL_CLIENT`.
 */
const withModel = Effect.provide(mockModel({ _tag: "Fixed", latencyMs: 0 }));

const BySession = Schema.Struct({ sessionId: Schema.UUID });

const notFound = { _tag: "ReportNotFound" } as const;
const notSignedIn = { _tag: "NotSignedIn" } as const;

/** The report's fixed parts: title, status and the problems with their rubrics. */
export const getReport = createServerFn({ method: "GET" })
  .validator(Schema.standardSchemaV1(BySession))
  .handler(({ data }) =>
    run(
      Effect.gen(function* () {
        const session = yield* ownedSession(data.sessionId);
        const header = yield* reportHeader(session);
        const problems = yield* reportProblems(session.assignmentId);
        return ok({ header, problems });
      }).pipe(
        Effect.catchTags({
          ReportNotFound: () => Effect.succeed(err(notFound)),
          NotSignedIn: () => Effect.succeed(err(notSignedIn)),
        }),
      ),
    ),
  );

/** Common mistakes for the weak problems as they stand now. */
export const getMistakes = createServerFn({ method: "POST" })
  .validator(Schema.standardSchemaV1(BySession))
  .handler(({ data }) =>
    run(
      Effect.gen(function* () {
        const session = yield* ownedSession(data.sessionId);
        const problems = yield* reportProblems(session.assignmentId);
        const report = buildReport(yield* reportInput(session.id, problems));
        return ok(yield* mistakesFor(session.id, report).pipe(withModel));
      }).pipe(
        Effect.catchTags({
          ReportNotFound: () => Effect.succeed(err(notFound)),
          NotSignedIn: () => Effect.succeed(err(notSignedIn)),
        }),
      ),
    ),
  );

/** The session's view-only link token, made the first time the teacher shares. */
export const shareReport = createServerFn({ method: "POST" })
  .validator(Schema.standardSchemaV1(BySession))
  .handler(({ data }) =>
    run(
      Effect.gen(function* () {
        const session = yield* ownedSession(data.sessionId);
        if (session.reportShareToken !== null) return ok({ token: session.reportShareToken });
        const db = yield* Db;
        // Only one token per session, even if the teacher clicks twice at once.
        yield* db
          .update(schema.classSessions)
          .set({ reportShareToken: randomBytes(16).toString("base64url") })
          .where(
            and(
              eq(schema.classSessions.id, session.id),
              isNull(schema.classSessions.reportShareToken),
            ),
          );
        const [row] = yield* db
          .select({ token: schema.classSessions.reportShareToken })
          .from(schema.classSessions)
          .where(eq(schema.classSessions.id, session.id));
        if (row?.token == null) return yield* Effect.die("share token missing after update");
        return ok({ token: row.token });
      }).pipe(
        Effect.catchTags({
          ReportNotFound: () => Effect.succeed(err(notFound)),
          NotSignedIn: () => Effect.succeed(err(notSignedIn)),
        }),
      ),
    ),
  );

const ShareToken = Schema.Struct({ token: Schema.String });
/** Tokens are base64url. A truncated or mangled link is just "not found", like a wrong one. */
const isTokenShaped = (token: string) => /^[\w-]{16,64}$/.test(token);

/** The shared report: class results with every student name removed here, on the server. */
export const getSharedReport = createServerFn({ method: "GET" })
  .validator(Schema.standardSchemaV1(ShareToken))
  .handler(({ data }) =>
    run(
      Effect.gen(function* () {
        if (!isTokenShaped(data.token)) return err(notFound);
        const session = yield* sharedSession(data.token);
        const header = yield* reportHeader(session);
        const problems = yield* reportProblems(session.assignmentId);
        const input = yield* reportInput(session.id, problems);
        const mistakes = yield* mistakesFor(session.id, buildReport(input)).pipe(withModel);
        return ok({ header, input: anonymize(input), mistakes });
      }).pipe(Effect.catchTags({ ReportNotFound: () => Effect.succeed(err(notFound)) })),
    ),
  );
