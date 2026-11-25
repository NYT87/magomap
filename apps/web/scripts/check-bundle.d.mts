export const INITIAL_JS_BUDGET: number;
export function entryScripts(html: string): string[];
export function checkBundle(
  dir: string,
  budget?: number,
): { gzipBytes: number; problems: string[] };
