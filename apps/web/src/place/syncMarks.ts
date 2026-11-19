import { useLiveQuery } from "dexie-react-hooks";
import { currentDb } from "../data/db";

/** Which rows of a table still wait in the outbox, and which the server refused (with their text). */
export function useSyncMarks(table: "visit_notes" | "links") {
  return useLiveQuery(
    async () => {
      const db = currentDb();
      const pending = new Set(
        (await db.outbox.toArray()).filter((e) => e.table === table).map((e) => e.id),
      );
      const refused = new Set(
        (await db.rejected.toArray()).filter((r) => r.table === table).map((r) => r.id),
      );
      return { pending, refused };
    },
    [table],
    { pending: new Set<string>(), refused: new Set<string>() },
  );
}
