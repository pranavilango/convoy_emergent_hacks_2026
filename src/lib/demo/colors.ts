/**
 * Colors a location type can take. Chosen to read clearly both as map pins on the dark ink map
 * and as swatches on the terracotta panel (swatches get an ink outline there).
 */
export const TYPE_COLORS = [
  { name: "Amber", value: "#f2b33d" },
  { name: "Sky", value: "#5cc8ff" },
  { name: "Mint", value: "#4fd1a5" },
  { name: "Cream", value: "#f2e5db" },
  { name: "Rose", value: "#ff7aa8" },
  { name: "Violet", value: "#a99bff" },
  { name: "Lime", value: "#c6e05a" },
  { name: "Coral", value: "#ff8a5c" },
] as const;

export type TypeColor = (typeof TYPE_COLORS)[number]["value"];

const COLOR_VALUES: readonly string[] = TYPE_COLORS.map((c) => c.value);

export function isTypeColor(value: unknown): value is TypeColor {
  return typeof value === "string" && COLOR_VALUES.includes(value);
}

export function colorName(value: string): string {
  return TYPE_COLORS.find((c) => c.value === value)?.name ?? value;
}

/** First color not already used by an existing type, so new types look distinct by default. */
export function nextUnusedColor(used: readonly string[]): TypeColor {
  return (TYPE_COLORS.find((c) => !used.includes(c.value)) ?? TYPE_COLORS[0]).value;
}
