import { useRegisterUpdates } from "./useAppUpdate";

/**
 * Registers the service worker and starts the update checks. Rendered once, at the top of the
 * app, where it never remounts (not inside sign-in gating or a layout that moves), so there is
 * one Workbox instance and one check clock.
 */
export function UpdateRegistration() {
  useRegisterUpdates();
  return null;
}
