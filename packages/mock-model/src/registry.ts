/**
 * Profiles and recordings bundled with the package, by name.
 *
 * They ship as code so every serverless instance has them without a database
 * read, and a load-test run is reproducible from a commit. Import new call-log
 * snapshots with `scripts/import-calls.ts` and add them here.
 */
import { expandCalls } from "./compact.ts";
import {
  claudeHaiku55Calls,
  claudeHaiku55Source,
  claudeHaiku55T0,
} from "./data/claude-haiku-5.5.ts";
import type { Profile } from "./profile.ts";
import type { Recording } from "./replay.ts";
import { seedProfile, seedWindow } from "./seed.ts";

const haikuCalls = expandCalls(claudeHaiku55T0, claudeHaiku55Calls);

/** Measured calls for the grading model. The default for sampled and replay modes. */
export const DEFAULT_PROFILE = "claude-haiku-5.5";
export const DEFAULT_RECORDING = "claude-haiku-5.5";

export const profileNames = ["claude-haiku-5.5", "seed"] as const;
export type ProfileName = (typeof profileNames)[number];
export const profiles: Record<ProfileName, Profile> = {
  "claude-haiku-5.5": { _tag: "Empirical", source: claudeHaiku55Source, calls: haikuCalls },
  seed: seedProfile,
};

export const recordingNames = ["claude-haiku-5.5", "seed-window"] as const;
export type RecordingName = (typeof recordingNames)[number];
export const recordings: Record<RecordingName, Recording> = {
  "claude-haiku-5.5": { source: claudeHaiku55Source, calls: haikuCalls },
  "seed-window": seedWindow,
};
