/** A new version found this soon after the page loaded is applied at once; later, she is asked. */
export const COLD_START_MS = 3000;
/** While the app stays in view, ask the server about a new version this often. */
export const CHECK_EVERY_MS = 30 * 60 * 1000;

export function onUpdateFound(sinceLoadMs: number): "apply" | "prompt" {
  return sinceLoadMs < COLD_START_MS ? "apply" : "prompt";
}

export function dueForCheck(nowMs: number, lastCheckMs: number): boolean {
  return nowMs - lastCheckMs >= CHECK_EVERY_MS;
}
