/**
 * Students have no accounts (PRD, "Launch and join"). After joining, a student's browser holds a
 * signed cookie per session naming their student id. It proves which student a request speaks
 * for; the teacher in the room is the check on who that student really is.
 */
import { timingSafeEqual } from "node:crypto";
import { Config, Effect, Option, Redacted } from "effect";

const cookieName = (sessionId: string) => `gb_student_${sessionId}`;

const secret = Config.redacted("STUDENT_COOKIE_SECRET");

const hmac = (key: Redacted.Redacted, message: string) =>
  Effect.promise(async () => {
    const cryptoKey = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(Redacted.value(key)),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const signature = await crypto.subtle.sign(
      "HMAC",
      cryptoKey,
      new TextEncoder().encode(message),
    );
    return Buffer.from(signature).toString("base64url");
  });

/** The cookie that identifies this browser as the student in the session. */
export const studentCookie = (sessionId: string, studentId: string) =>
  Effect.gen(function* () {
    const signature = yield* hmac(yield* secret, `${sessionId}.${studentId}`);
    return {
      name: cookieName(sessionId),
      value: `${studentId}.${signature}`,
      // Lax, so the cookie survives arriving from a QR code scan.
      options: {
        path: "/",
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        maxAge: 60 * 60 * 24,
      } as const,
    };
  });

/** The student id this request's cookie proves for the session, if any. */
export const studentFromCookies = (cookieHeader: string | null, sessionId: string) =>
  Effect.gen(function* () {
    const name = `${cookieName(sessionId)}=`;
    const raw = (cookieHeader ?? "")
      .split(/;\s*/)
      .find((part) => part.startsWith(name))
      ?.slice(name.length);
    if (raw === undefined) return Option.none<string>();
    const [studentId, signature] = raw.split(".");
    if (studentId === undefined || signature === undefined) return Option.none<string>();
    const expected = yield* hmac(yield* secret, `${sessionId}.${studentId}`);
    const matches =
      expected.length === signature.length &&
      timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
    return matches ? Option.some(studentId) : Option.none<string>();
  });
