/**
 * Join codes are six digits, like Kahoot: easy to read off a projector and to type on a phone's
 * number pad. They are unique among sessions that have not ended (a partial unique index), so a
 * code is reused only after its session ends.
 */
import { Schema } from "effect"

export const JoinCode = Schema.String.pipe(Schema.pattern(/^[0-9]{6}$/), Schema.brand("JoinCode"))
export type JoinCode = typeof JoinCode.Type

/** A random code. The caller retries on a unique violation. */
export const randomJoinCode = (): JoinCode => {
  const n = crypto.getRandomValues(new Uint32Array(1))[0] ?? 0
  return JoinCode.make((n % 1_000_000).toString().padStart(6, "0"))
}

/** Strips spaces and dashes a student might type: "482 913" or "482-913". */
export const parseJoinCodeInput = (input: string) =>
  Schema.decodeUnknownOption(JoinCode)(input.replace(/[\s-]/g, ""))
