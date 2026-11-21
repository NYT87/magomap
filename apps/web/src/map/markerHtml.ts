import type { MapMarker } from "./MapAdapter";

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/**
 * A pin drawn in HTML/SVG so both maps look the same. Saved: a filled pin in the list colour.
 * Previous: the same pin, hollow, faded and smaller, with a Clay outline. Search: an Ink ring.
 */
export function markerHtml(m: MapMarker): string {
  const label = escapeHtml(m.label);
  if (m.kind === "search") {
    return `<span class="mm-pin mm-pin--search" title="${label}"><svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true"><circle cx="12" cy="12" r="8" fill="none" stroke="var(--color-text)" stroke-width="3"/></svg></span>`;
  }
  const previous = m.kind === "previous";
  if (m.selected && m.kind === "saved") {
    // Bigger, with a ring (Ink over a halo of the page colour, so it reads on light and dark tiles).
    const pin = "M12 2.5c-4 0-7 3-7 7 0 5.2 7 12 7 12s7-6.8 7-12c0-4-3-7-7-7Z";
    return `<span class="mm-pin mm-pin--saved mm-pin--selected" title="${label}"><svg viewBox="0 0 24 24" width="40" height="40" aria-hidden="true"><path d="${pin}" fill="var(--color-bg)" stroke="var(--color-bg)" stroke-width="4.5" stroke-linejoin="round"/><path class="mm-pin__ring" d="${pin}" fill="none" stroke="var(--color-text)" stroke-width="2.5" stroke-linejoin="round"/><path d="${pin}" fill="${m.color}"/><circle cx="12" cy="9.5" r="2.6" fill="var(--color-bg)"/></svg></span>`;
  }
  const size = previous ? 22 : 32;
  const body = previous
    ? `<path d="M12 2.5c-4 0-7 3-7 7 0 5.2 7 12 7 12s7-6.8 7-12c0-4-3-7-7-7Z" fill="${m.color}" fill-opacity="0.45" stroke="var(--color-clay)" stroke-width="1.5"/><circle cx="12" cy="9.5" r="2.6" fill="var(--color-bg)"/>`
    : `<path d="M12 2.5c-4 0-7 3-7 7 0 5.2 7 12 7 12s7-6.8 7-12c0-4-3-7-7-7Z" fill="${m.color}" stroke="var(--color-bg)" stroke-width="1.5"/><circle cx="12" cy="9.5" r="2.6" fill="var(--color-bg)"/>`;
  return `<span class="mm-pin mm-pin--${m.kind}" title="${label}"><svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${body}</svg></span>`;
}

/** Every marker is a 44 px target. */
export const HIT = 44;
