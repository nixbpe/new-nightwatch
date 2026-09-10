/**
 * Two-character mark for an avatar or organization badge. Multi-word names
 * take the first character of the first two words ("Orbit Digital" → "OD");
 * single words take their first two code points, which for Thai keeps the
 * base consonants and drops trailing marks ("นภัส" → "นภ").
 */
export function initialsOf(name: string): string {
  const words = name
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "");
  const [first, second] = words;
  if (first === undefined) {
    return "";
  }
  if (second !== undefined) {
    return `${Array.from(first)[0] ?? ""}${Array.from(second)[0] ?? ""}`.toUpperCase();
  }
  return Array.from(first).slice(0, 2).join("").toUpperCase();
}
