/**
 * ARCH-017 Search Query normalization mirror (task 32; ARCH-002, ARCH-010,
 * ARCH-017, REQ-021, ISSUE-009).
 *
 * Phase 9 decides browser Search Query emptiness exactly by whether the
 * ARCH-017 normalization contract produces an empty Search Query: NFC
 * canonical composition, Unicode whitespace trimming and collapsing to
 * ASCII spaces, and Unicode lowercase mapping. The Go backend applies the
 * same pipeline through `strings.FieldsFunc(norm.NFC.String(s),
 * unicode.IsSpace)` (backend/internal/repository/suggest.go), so the
 * whitespace set here mirrors Go's `unicode.IsSpace` — the Unicode
 * White_Space property plus the Latin-1 control spaces, including
 * `U+0085` NEXT LINE, `U+00A0` NO-BREAK SPACE, `U+2000`–`U+200A`,
 * `U+2028`, `U+2029`, `U+202F`, `U+205F`, and `U+3000`. Canonical
 * equivalence and letter case never affect the emptiness decision, but the
 * pipeline stays a faithful mirror so the browser and backend always agree
 * on which drafts are normalized-empty.
 *
 * The browser keeps the exact raw Search Query unchanged in the
 * interaction state and the field; this module only classifies drafts. A
 * normalized-empty draft enables no suggestion request (ARCH-010) and is a
 * strict Enter no-op (REQ-021, ISSUE-009): it retains the exact raw value,
 * Search focus, and the current interaction state, shows no validation
 * message or invalid state, and starts neither a suggestion request nor a
 * Substitution Search request.
 */

/**
 * Go-compatible Unicode whitespace (Go `unicode.IsSpace`, ARCH-017).
 * Unicode's `White_Space` property contains the Latin-1 control spaces,
 * `U+0085` NEXT LINE, `U+00A0` NO-BREAK SPACE, `U+1680`,
 * `U+2000`–`U+200A`, `U+2028`, `U+2029`, `U+202F`, `U+205F`, and
 * `U+3000`. JavaScript's `\s` is not used because it adds `U+FEFF` and
 * would classify a byte-order-mark-only draft differently from Go
 * (ISSUE-009).
 */
const GO_WHITESPACE = /\p{White_Space}/u;

/**
 * Applies the ARCH-017 normalization pipeline to one raw Search Query,
 * mirroring the backend `normalize` function: NFC canonical composition,
 * Unicode whitespace trimming and collapsing to ASCII spaces, and Unicode
 * lowercase mapping. The returned value is the normalized Search Query the
 * backend would compare against candidate names; the browser uses it only
 * to classify drafts and never sends it in place of the exact raw value.
 *
 * @param raw - the exact raw Search Query text from the interaction state
 * @returns the ARCH-017 normalized Search Query
 */
export function normalizeSearchQuery(raw: string): string {
  return raw
    .normalize("NFC")
    .split(GO_WHITESPACE)
    .filter((part) => part.length > 0)
    .join(" ")
    .toLowerCase();
}

/**
 * Reports whether the ARCH-017 normalization contract produces an empty
 * Search Query for the given raw draft (REQ-021, ARCH-010). A
 * normalized-empty draft enables no suggestion request and is a strict
 * Enter no-op; the exact raw value stays in the interaction state and the
 * field unchanged (ISSUE-009).
 *
 * @param raw - the exact raw Search Query text from the interaction state
 * @returns whether the normalized Search Query is empty
 */
export function isNormalizedEmptySearchQuery(raw: string): boolean {
  return normalizeSearchQuery(raw) === "";
}
