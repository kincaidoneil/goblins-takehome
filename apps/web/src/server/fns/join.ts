import { joinSession, parseJoinCodeInput } from "@goblins/domain";
import { randomCreatureId } from "@goblins/ui";
import { createServerFn } from "@tanstack/react-start";
import { setCookie } from "@tanstack/react-start/server";
import { Effect, Option, Schema } from "effect";
import { err, ok } from "../result";
import { run } from "../runtime";
import { studentCookie } from "../student-identity";

const JoinInput = Schema.Struct({ joinCode: Schema.String, name: Schema.String });

/** Join a session by code and name, or resume the student with the same name. */
export const join = createServerFn({ method: "POST" })
  .validator(Schema.standardSchemaV1(JoinInput))
  .handler(({ data }) =>
    run(
      Effect.gen(function* () {
        const joinCode = parseJoinCodeInput(data.joinCode);
        if (Option.isNone(joinCode)) return err({ _tag: "SessionNotFound" } as const);
        const { student, resumed } = yield* joinSession({
          joinCode: joinCode.value,
          name: data.name,
          pickAvatar: (taken) => randomCreatureId(taken),
        });
        const cookie = yield* studentCookie(student.sessionId, student.id);
        setCookie(cookie.name, cookie.value, cookie.options);
        return ok({
          sessionId: student.sessionId,
          studentId: student.id,
          displayName: student.displayName,
          avatarId: student.avatarId,
          resumed,
        });
      }).pipe(
        Effect.catchTags({
          SessionNotFound: () => Effect.succeed(err({ _tag: "SessionNotFound" } as const)),
          InvalidName: (e) =>
            Effect.succeed(err({ _tag: "InvalidName", reason: e.reason } as const)),
        }),
      ),
    ),
  );
