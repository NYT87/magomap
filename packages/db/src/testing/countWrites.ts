import type { Db } from "../core";

/** Wraps `atomic` and sums the rows each statement changed (`numAffectedRows`), for write-budget tests. */
export function countWrites(db: Db): { db: Db; written(): number; reset(): void } {
  let total = 0n;
  return {
    db: {
      ...db,
      atomic: async (queries) => {
        const results = await db.atomic(queries);
        for (const r of results) total += r.numAffectedRows ?? 0n;
        return results;
      },
    },
    written: () => Number(total),
    reset: () => {
      total = 0n;
    },
  };
}
