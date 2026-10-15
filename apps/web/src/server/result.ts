/**
 * Server functions return expected failures as values, not exceptions, so the client handles
 * each one by its tag. Unexpected failures (a database outage, a bug) still reject the request.
 */
export type Result<A, E extends { readonly _tag: string }> =
  | { readonly _tag: "Ok"; readonly value: A }
  | { readonly _tag: "Err"; readonly error: E }

export const ok = <A>(value: A) => ({ _tag: "Ok", value }) as const

export const err = <E extends { readonly _tag: string }>(error: E) => ({ _tag: "Err", error }) as const
