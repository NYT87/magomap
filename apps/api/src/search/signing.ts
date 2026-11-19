// Search results are signed by the server, so a pushed place proves it came from a real
// provider search (and can't carry made-up coordinates or titles into shared data).
import { createHmac, timingSafeEqual } from "node:crypto";
import { CLOCK_ALLOWANCE_MS, type SearchResult, searchSignaturePayload } from "@magomap/domain";

/** A saved search result may sit in the offline queue for a while before it syncs. */
export const SIGNATURE_MAX_AGE_MS = 30 * 86_400_000;

type Signable = Parameters<typeof searchSignaturePayload>[0];

function hmac(secret: string, payload: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signSearchResult(
  secret: string,
  result: Signable,
  now: number,
): { signedAt: number; signature: string } {
  return { signedAt: now, signature: hmac(secret, searchSignaturePayload(result, now)) };
}

export function verifySearchSignature(secret: string, result: SearchResult, now?: number): boolean {
  if (typeof result.signature !== "string" || typeof result.signedAt !== "number") return false;
  if (
    now !== undefined &&
    (result.signedAt > now + CLOCK_ALLOWANCE_MS || now - result.signedAt > SIGNATURE_MAX_AGE_MS)
  ) {
    return false;
  }
  const expected = Buffer.from(hmac(secret, searchSignaturePayload(result, result.signedAt)));
  const given = Buffer.from(result.signature);
  return expected.length === given.length && timingSafeEqual(expected, given);
}

/** Verifies a pushed place row: its location fields must be exactly what the server signed. */
export function verifyPushedPlace(
  secret: string,
  row: Record<string, unknown>,
  now: number,
): boolean {
  const source = row.source as {
    provider: string;
    externalId: string;
    signature: string;
    signedAt: number;
  };
  return verifySearchSignature(
    secret,
    {
      provider: source.provider,
      externalId: source.externalId,
      title: row.title as string,
      address: (row.address as string | null) ?? null,
      roadAddress: (row.roadAddress as string | null) ?? null,
      category: (row.category as string | null) ?? null,
      phone: (row.phone as string | null) ?? null,
      lat: row.lat as number,
      lng: row.lng as number,
      signature: source.signature,
      signedAt: source.signedAt,
    },
    now,
  );
}
