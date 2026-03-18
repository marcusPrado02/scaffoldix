/**
 * Parses a human-readable duration string into milliseconds.
 *
 * Supported formats:
 * - `"500ms"` → 500 ms
 * - `"30s"` → 30 000 ms
 * - `"2m"` → 120 000 ms
 * - `"1h"` → 3 600 000 ms
 * - `"90"` (bare integer/float, no unit) → 90 000 ms (treated as seconds)
 *
 * Unit matching is case-insensitive. Fractional values are supported (`"1.5m"` → 90 000 ms).
 *
 * @param value - Duration string or `undefined`
 * @returns Duration in milliseconds, or `undefined` if the input is `undefined`,
 *   empty, or does not match a recognised format.
 *
 * @example
 * parseDurationMs("30s")   // 30000
 * parseDurationMs("2m")    // 120000
 * parseDurationMs("500ms") // 500
 * parseDurationMs("90")    // 90000 (bare number = seconds)
 * parseDurationMs(undefined) // undefined
 * parseDurationMs("abc")     // undefined
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
