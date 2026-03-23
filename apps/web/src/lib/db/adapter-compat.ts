/**
 * better-auth's SQLite adapter serializes string[] schema fields as JSON
 * arrays (e.g. '["openid","email"]'). Direct Drizzle queries bypass the
 * adapter and read the raw text. This function normalizes it back to string[].
 */
export function parseStoredStringArray(
  raw: string | string[] | null | undefined
): string[] {
  if (!raw) {
    return [];
  }
  if (Array.isArray(raw)) {
    return raw;
  }
  if (raw.startsWith("[")) {
    try {
      const parsed: unknown = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed.filter((s): s is string => typeof s === "string");
      }
    } catch {
      // fall through to space-split
    }
  }
  return raw.split(" ").filter(Boolean);
}
