/** The focusable host of the selected pin: Leaflet's marker icon, Kakao's button. */
function selectedHost(root: HTMLElement): HTMLElement | null {
  const host = root
    .querySelector(".mm-pin--selected")
    ?.closest<HTMLElement>(".leaflet-marker-icon, button");
  return host ?? null;
}

/**
 * Redrawing the pins replaces the one a keyboard user just pressed, dropping focus to the page.
 * Runs `redraw`, and if focus was inside the map, puts it on the selected pin afterwards.
 */
export function redrawKeepingFocus(root: HTMLElement | null, redraw: () => void) {
  const hadFocus = !!root && root.contains(document.activeElement);
  redraw();
  if (!root || !hadFocus) return;
  const focus = () => selectedHost(root)?.focus({ preventScroll: true });
  focus();
  // Some libraries attach the new markers a moment after the call.
  requestAnimationFrame(() => {
    if (!root.contains(document.activeElement) || document.activeElement === document.body) focus();
  });
}
