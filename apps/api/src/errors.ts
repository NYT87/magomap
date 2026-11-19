import { AccountGoneError, WriteConflictError } from "@magomap/db/stores/sync";

/** Known errors and the response they become; null means "let it be a 500". */
export function errorResponse(
  error: unknown,
): { status: 401 | 503; body: { error: "busy" | "account_gone" } } | null {
  if (error instanceof WriteConflictError) return { status: 503, body: { error: "busy" } };
  if (error instanceof AccountGoneError) return { status: 401, body: { error: "account_gone" } };
  return null;
}
