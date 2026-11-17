import type { Request } from "@playwright/test";

/** Separates the landing example from requests caused by Search controls. */
export function isLandingDialogueRequest(request: Request): boolean {
  return request.headers()["x-obiad-request-purpose"] === "landing-dialogue";
}

/** Excludes background examples and font subset loads from action ledgers. */
export function isActionRequest(request: Request): boolean {
  return (
    !isLandingDialogueRequest(request) && request.resourceType() !== "font"
  );
}
