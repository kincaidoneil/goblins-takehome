/** Some models wrap JSON in a Markdown fence even when asked for JSON. */
export const stripFence = (text: string): string =>
  text
    .trim()
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/, "");
