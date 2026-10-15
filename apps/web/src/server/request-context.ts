/**
 * Request-scoped inputs, resolved before an effect runs and provided as a service.
 *
 * TanStack Start and Clerk find the current request through AsyncLocalStorage. Effect's scheduler
 * can run a fiber's next step under another request's async context, so `auth()`, `getCookie`
 * and `setCookie` must never be called inside an effect: under concurrent requests they can read
 * or write a different request. `run` (runtime.ts) reads everything here at the handler boundary.
 * Cookies to set are returned from the effect and set by the handler after `run` resolves.
 */
import { Context } from "effect";

export class RequestContext extends Context.Tag("@goblins/web/RequestContext")<
  RequestContext,
  {
    /** The signed-in teacher's Clerk user id, or null. */
    readonly clerkUserId: string | null;
    readonly cookies: Readonly<Record<string, string>>;
  }
>() {}
