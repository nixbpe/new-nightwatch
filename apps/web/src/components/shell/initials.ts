// Single words take their first two code points, which for Thai keeps base consonants ("นภัส" → "นภ").
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
