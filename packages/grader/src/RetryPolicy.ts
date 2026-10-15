/**
 * When a model call fails, decide whether to try again later or give up and mark
 * the grade "couldn't grade". Pure, so it is tested directly.
 *
 * The time budget is what makes a 5-minute provider outage delay grades instead
 * of failing them: transient errors keep retrying for 15 minutes, with backoff
 * capped at 60 s so grades resume within a minute of the provider coming back.
 */
import { Duration } from "effect";
import { isRetryable, type ModelError } from "./ModelClient.ts";

export const policy = {
  /** Transient errors retry until the grade has waited this long. */
  giveUpAfter: Duration.minutes(15),
  /**
   * Unusable answers are retried right away inside one delivery, this many times in
   * total. Counting them per delivery keeps an outage's long delivery count from
   * turning one bad answer afterwards into a failed grade.
   */
  badResponseAttempts: 3,
  firstDelay: Duration.seconds(2),
  maxDelay: Duration.seconds(60),
  /** Below the sweeper's 3-minute threshold for grades waiting in `submitted`. */
  maxRetryAfter: Duration.minutes(2),
};

export type Decision =
  | { readonly _tag: "Retry"; readonly after: Duration.Duration }
  | { readonly _tag: "GiveUp"; readonly reason: string };

/** 2 s, 4 s, 8 s ... capped at 60 s, with ±20% jitter so a burst of failures does not retry in lockstep. */
export const backoff = (deliveryCount: number, random: number): Duration.Duration => {
  const base = Math.min(
    Duration.toMillis(policy.maxDelay),
    Duration.toMillis(policy.firstDelay) * 2 ** Math.max(0, deliveryCount - 1),
  );
  return Duration.millis(Math.round(base * (0.8 + 0.4 * random)));
};

const describe = (error: ModelError): string => {
  switch (error._tag) {
    case "RateLimited":
      return "the model provider kept rate-limiting us";
    case "Timeout":
      return "the model kept timing out";
    case "ProviderError":
      return `the model provider returned an error (${error.status}): ${error.message}`;
    case "BadResponse":
      return `the model's answer was unusable: ${error.message}`;
  }
};

export const decide = (input: {
  readonly error: ModelError;
  /** 1 on the first delivery. */
  readonly deliveryCount: number;
  /** How long since the job was first enqueued. */
  readonly age: Duration.Duration;
  /** A number in [0, 1) for jitter. */
  readonly random: number;
}): Decision => {
  const { error, deliveryCount, age, random } = input;
  // A BadResponse reaching here already failed `badResponseAttempts` times in a row.
  if (!isRetryable(error) || error._tag === "BadResponse")
    return { _tag: "GiveUp", reason: describe(error) };
  if (Duration.greaterThanOrEqualTo(age, policy.giveUpAfter)) {
    return { _tag: "GiveUp", reason: describe(error) };
  }
  const delay = backoff(deliveryCount, random);
  const retryAfterMs =
    error._tag === "RateLimited" || error._tag === "ProviderError" ? error.retryAfterMs : undefined;
  // Honor Retry-After, but never wait past `maxRetryAfter`: a grade released for longer
  // than the sweeper's threshold would look lost and be sent again.
  const hinted =
    retryAfterMs === undefined
      ? delay
      : Duration.min(Duration.max(delay, Duration.millis(retryAfterMs)), policy.maxRetryAfter);
  return { _tag: "Retry", after: hinted };
};
