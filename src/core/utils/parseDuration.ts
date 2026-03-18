/**
 * Parses a human-readable duration string into milliseconds.
 *
 * Supported formats:
 * - `"30s"` → 30 000 ms
 * - `"2m"` → 120 000 ms
 * - `"1h"` → 3 600 000 ms
 * - `"90"` (bare number) → 90 000 ms (treated as seconds)
 *
 * Returns `undefined` if the input is `undefined` or cannot be parsed.
 */
export function parseDurationMs(value: string | undefined): number | undefined {
  if (value === undefined || value.trim() === "") return undefined;

  const trimmed = value.trim();

  const match = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h)?$/i.exec(trimmed);
  if (!match) return undefined;

  const num = parseFloat(match[1]);
  const unit = (match[2] ?? "s").toLowerCase();

  switch (unit) {
    case "ms":
      return Math.round(num);
    case "s":
      return Math.round(num * 1_000);
    case "m":
      return Math.round(num * 60_000);
    case "h":
      return Math.round(num * 3_600_000);
    default:
      return undefined;
  }
}
