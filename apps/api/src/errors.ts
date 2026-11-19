import { WriteConflictError } from "@magomap/db/stores/sync";

/** Known errors and the response they become; null means "let it be a 500". */
export function errorResponse(error: unknown): { status: 503; body: { error: "busy" } } | null {
  if (error instanceof WriteConflictError) return { status: 503, body: { error: "busy" } };
  return null;
}
