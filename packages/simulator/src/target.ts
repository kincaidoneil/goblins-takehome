/**
 * Where the simulator sends traffic, and the headers that mark it as a load test.
 *
 * With a load-test token, every request carries `x-goblins-load-test: <token>:<runId>`. The app
 * routes those requests to the mock model, stamps the run id on the data they create, and lets
 * `x-goblins-load-test-teacher` stand in for Clerk sign-in. See `@goblins/mock-model`'s
 * `authorizeLoadTest`.
 */
export const LOAD_TEST_HEADER = "x-goblins-load-test";
export const MOCK_SPEC_HEADER = "x-goblins-mock-model";
export const LOAD_TEST_TEACHER_HEADER = "x-goblins-load-test-teacher";

export interface Target {
  /** The app's origin, e.g. `https://goblins-autograder.vercel.app` or `http://localhost:3190`. */
  readonly baseUrl: string;
  /** Without a token, requests are ordinary traffic: no load-test tag, the app's normal model. */
  readonly token: string | undefined;
  /** `[A-Za-z0-9_-]{1,64}`. Tags every row the run creates, for exclusion and deletion. */
  readonly runId: string;
  /** Mock model spec, e.g. `mode=sampled; profile=seed; start=…`. */
  readonly mockSpec: string;
}

export const loadTestHeaders = (target: Target): Record<string, string> =>
  target.token === undefined
    ? {}
    : {
        [LOAD_TEST_HEADER]: `${target.token}:${target.runId}`,
        [MOCK_SPEC_HEADER]: target.mockSpec,
      };

export const RUN_ID = /^[A-Za-z0-9_-]{1,64}$/;
