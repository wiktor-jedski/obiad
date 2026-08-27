const GO_WHITESPACE = /\p{White_Space}/u;

export function normalizeSearchQuery(raw: string): string {
  return raw
    .normalize("NFC")
    .split(GO_WHITESPACE)
    .filter((part) => part.length > 0)
    .join(" ")
    .toLowerCase();
}

export function isNormalizedEmptySearchQuery(raw: string): boolean {
  return normalizeSearchQuery(raw) === "";
}
