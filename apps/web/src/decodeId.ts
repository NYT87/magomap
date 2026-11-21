/** A route id, decoded; the raw text when it isn't valid percent-encoding (never throws). */
export function decodeId(raw: string): string;
export function decodeId(raw: string | undefined): string | undefined;
export function decodeId(raw: string | undefined): string | undefined {
  if (raw === undefined) return undefined;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}
