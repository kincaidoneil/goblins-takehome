/**
 * Profiles and recordings bundled with the package, by name.
 *
 * They ship as code so every serverless instance has them without a database
 * read, and a load-test run is reproducible from a commit. Add exported
 * call-log snapshots here as they are recorded.
 */
import type { Profile } from "./profile.ts";
import type { Recording } from "./replay.ts";
import { seedProfile, seedWindow } from "./seed.ts";

export const profileNames = ["seed"] as const;
export type ProfileName = (typeof profileNames)[number];
export const profiles: Record<ProfileName, Profile> = { seed: seedProfile };

export const recordingNames = ["seed-window"] as const;
export type RecordingName = (typeof recordingNames)[number];
export const recordings: Record<RecordingName, Recording> = { "seed-window": seedWindow };
