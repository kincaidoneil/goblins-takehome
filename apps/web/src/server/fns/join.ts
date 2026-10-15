import { joinSession, parseJoinCodeInput } from "@goblins/domain";
import { randomCreatureId } from "@goblins/ui";
import { createServerFn } from "@tanstack/react-start";
import { getRequest, setCookie } from "@tanstack/react-start/server";
import { Effect, Option, Schema } from "effect";
import { clientIp, joinAllowed, joinMissed } from "../abuse";
import { err, ok } from "../result";
import { run } from "../runtime";
import { studentCookie } from "../student-identity";

const JoinInput = Schema.Struct({ joinCode: Schema.String, name: Schema.String });

/**
 * Join a session by code and name, or resume the student with the same name.
 *
 * The cookie is set after the Effect finishes, back in the request's own async context. TanStack
 * Start finds the current request through AsyncLocalStorage, and an Effect fiber can resume in
 * another request's context, which would put this student's cookie on someone else's response.
 */
export const join = createServerFn({ method: "POST" })
  .validator(Schema.standardSchemaV1(JoinInput))
  .handler(async ({ data }) => {
    const ip = clientIp(getRequest().headers);
    const result = await run(
      Effect.gen(function* () {
        if (!(yield* joinAllowed(ip))) return err({ _tag: "RateLimited" } as const);
        const joinCode = parseJoinCodeInput(data.joinCode);
        if (Option.isNone(joinCode)) {
          yield* joinMissed(ip);
          return err({ _tag: "SessionNotFound" } as const);
        }
        const { student, resumed } = yield* joinSession({
          joinCode: joinCode.value,
          name: data.name,
          pickAvatar: (taken) => randomCreatureId(taken),
        });
        const cookie = yield* studentCookie(student.sessionId, student.id);
        return ok({
          cookie,
          student: {
            sessionId: student.sessionId,
            studentId: student.id,
            displayName: student.displayName,
            avatarId: student.avatarId,
            resumed,
          },
        });
      }).pipe(
        Effect.catchTags({
          SessionNotFound: () =>
            Effect.as(joinMissed(ip), err({ _tag: "SessionNotFound" } as const)),
          SessionFull: () => Effect.succeed(err({ _tag: "SessionFull" } as const)),
          InvalidName: (e) =>
            Effect.succeed(err({ _tag: "InvalidName", reason: e.reason } as const)),
        }),
      ),
    );
    if (result._tag === "Err") return result;
    const { cookie, student } = result.value;
    setCookie(cookie.name, cookie.value, cookie.options);
    return ok(student);
  });
