/**
 * Student names. One rule (PRD, "Names"): entering the same name in the same session, on any
 * device, resumes that student. Names match regardless of case, spacing, punctuation and accents,
 * so "maya r" resumes "Maya R." and "jose" resumes "José".
 */

/** The key two names must share to be the same student. Empty when the name has no letters or digits. */
export const normalizeName = (name: string): string =>
  name
    .normalize("NFKD")
    // Drop only the combining accents used on Latin, Greek and Cyrillic letters. Marks in other
    // scripts (Devanagari vowel signs, for example) are part of the spelling and stay.
    .replace(/[\u0300-\u036f]/g, "")
    .normalize("NFC")
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}]/gu, "")

/** Collapses runs of whitespace and trims, keeping the student's own capitalization. */
export const cleanDisplayName = (name: string): string => name.trim().replace(/\s+/g, " ")

export const MAX_NAME_LENGTH = 40
