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

// TYP-04: only Latin initials take the monospace; Thai initials stay in the sans-serif
// because JetBrains Mono has no Thai glyphs.
export function initialsFontClass(initials: string): string {
  return /^[A-Za-z0-9]*$/.test(initials) ? "font-mono" : "font-sans";
}
