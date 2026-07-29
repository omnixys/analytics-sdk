const BLOCKED_KEYS = new Set([
  "password",
  "token",
  "authorization",
  "cookie",
  "secret",
  "signature",
  "access_token",
  "refresh_token",
  "api_key",
  "writekey",
]);

export function sanitizeProperties(
  value: Record<string, unknown> | undefined,
  depth = 0,
): Record<string, unknown> {
  if (!value || depth > 5) return {};
  const result: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    if (BLOCKED_KEYS.has(key.toLowerCase())) continue;
    result[key] = sanitizeValue(item, depth + 1);
  }
  return result;
}

function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > 5) return "[max-depth]";
  if (Array.isArray(value)) {
    return value.slice(0, 100).map((item) => sanitizeValue(item, depth + 1));
  }
  if (value && typeof value === "object") {
    return sanitizeProperties(value as Record<string, unknown>, depth);
  }
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  return String(value);
}
