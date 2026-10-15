/**
 * Student names as a class would type them: a first name and a last initial ("Maya R.").
 * Unique within a class, so each simulated student is a distinct student on the dashboard.
 */
import type { Rng } from "./rng.ts";

const FIRST_NAMES = [
  "Maya",
  "Liam",
  "Sofia",
  "Noah",
  "Ava",
  "Mateo",
  "Zoe",
  "Elijah",
  "Aaliyah",
  "Lucas",
  "Priya",
  "Ethan",
  "Camila",
  "Jayden",
  "Hana",
  "Omar",
  "Isabella",
  "Kai",
  "Chloe",
  "Diego",
  "Amara",
  "Leo",
  "Nora",
  "Malik",
  "Grace",
  "Santiago",
  "Lily",
  "Aiden",
  "Fatima",
  "Mason",
  "Yuki",
  "Elena",
  "Andre",
  "Ruby",
  "Tariq",
  "Mila",
  "Jonah",
  "Layla",
  "Theo",
  "Ximena",
  "Caleb",
  "Imani",
  "Ezra",
  "Valentina",
  "Rohan",
  "Stella",
  "Jamal",
  "Ivy",
  "Felix",
  "Nia",
] as const;
const INITIALS = "ABCDEFGHIJKLMNOPRSTVWY";

export const studentNames = (rng: Rng, count: number): ReadonlyArray<string> => {
  const taken = new Set<string>();
  const names: Array<string> = [];
  while (names.length < count) {
    const first = FIRST_NAMES[Math.floor(rng.next() * FIRST_NAMES.length)] ?? "Sam";
    const initial = INITIALS[Math.floor(rng.next() * INITIALS.length)] ?? "A";
    // Past 50 × 22 combinations a class would have to repeat, so number the rest.
    const base = `${first} ${initial}.`;
    const name = taken.has(base) ? `${first} ${initial}. ${names.length}` : base;
    if (taken.has(name)) continue;
    taken.add(name);
    names.push(name);
  }
  return names;
};

/**
 * How a student retypes their name on another device: lower case, no period, extra spaces.
 * The app must still resume the same student (PRD, "Names").
 */
export const retypedName = (name: string): string =>
  `  ${name.toLowerCase().replaceAll(".", "").replace(" ", "  ")} `;
