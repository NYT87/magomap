import { expect, it } from "vitest";
import { forEachDialect } from "../testing/dbs";
import {
  bindKakaoMapAccount,
  boundKakaoMapAccount,
  KakaoMapAccountTakenError,
  kakaoMapAccountHolder,
} from "./kakaoMapAccounts";
import { AccountGoneError } from "./sync";
import { createSession, deleteAccount, findOrCreateUserByIdentity } from "./users";

const now = 1_763_000_000_000;

async function user(db: Parameters<typeof deleteAccount>[0], id: string): Promise<string> {
  return (await findOrCreateUserByIdentity(db, "kakao", id, null, now)).userId;
}

forEachDialect("kakao map accounts", (makeDb) => {
  it("binds and reads back", async () => {
    const db = await makeDb();
    const a = await user(db, "a");
    expect(await boundKakaoMapAccount(db, a)).toBeNull();
    await bindKakaoMapAccount(db, a, { kakaoMapUserId: "km1", nickname: "지은" }, now);
    expect(await boundKakaoMapAccount(db, a)).toEqual({ kakaoMapUserId: "km1", nickname: "지은" });
  });

  it("tells which user holds an account", async () => {
    const db = await makeDb();
    const a = await user(db, "a");
    expect(await kakaoMapAccountHolder(db, "km1")).toBeNull();
    await bindKakaoMapAccount(db, a, { kakaoMapUserId: "km1" }, now);
    expect(await kakaoMapAccountHolder(db, "km1")).toBe(a);
    expect(await kakaoMapAccountHolder(db, "km2")).toBeNull();
  });

  it("re-binding the same user replaces the account", async () => {
    const db = await makeDb();
    const a = await user(db, "a");
    await bindKakaoMapAccount(db, a, { kakaoMapUserId: "km1", nickname: "지은" }, now);
    await bindKakaoMapAccount(db, a, { kakaoMapUserId: "km2" }, now + 1);
    expect(await boundKakaoMapAccount(db, a)).toEqual({ kakaoMapUserId: "km2", nickname: null });
  });

  it("another user's account is refused", async () => {
    const db = await makeDb();
    const a = await user(db, "a");
    const b = await user(db, "b");
    await bindKakaoMapAccount(db, a, { kakaoMapUserId: "km1" }, now);
    await bindKakaoMapAccount(db, b, { kakaoMapUserId: "km2" }, now);
    await expect(
      bindKakaoMapAccount(db, b, { kakaoMapUserId: "km1" }, now + 1),
    ).rejects.toBeInstanceOf(KakaoMapAccountTakenError);
    expect(await boundKakaoMapAccount(db, a)).toEqual({ kakaoMapUserId: "km1", nickname: null });
    expect(await boundKakaoMapAccount(db, b)).toEqual({ kakaoMapUserId: "km2", nickname: null });
    // the database stays usable after the refused write
    await createSession(db, b, now);
  });

  it("the same user binding their own account again is a no-op", async () => {
    const db = await makeDb();
    const a = await user(db, "a");
    await bindKakaoMapAccount(db, a, { kakaoMapUserId: "km1", nickname: "지은" }, now);
    await bindKakaoMapAccount(db, a, { kakaoMapUserId: "km1", nickname: "지은" }, now);
    expect(await boundKakaoMapAccount(db, a)).toEqual({ kakaoMapUserId: "km1", nickname: "지은" });
  });

  it("deleting the account removes the binding", async () => {
    const db = await makeDb();
    const a = await user(db, "a");
    const b = await user(db, "b");
    await bindKakaoMapAccount(db, a, { kakaoMapUserId: "km1" }, now);
    await deleteAccount(db, a);
    expect(await boundKakaoMapAccount(db, a)).toBeNull();
    await bindKakaoMapAccount(db, b, { kakaoMapUserId: "km1" }, now); // the account is free again
  });
});

forEachDialect("kakao map accounts (deleted user)", (makeDb) => {
  it("binding for a deleted user writes nothing and frees the account for its owner", async () => {
    const db = await makeDb();
    const a = await user(db, "a");
    const b = await user(db, "b");
    await deleteAccount(db, a);
    await expect(bindKakaoMapAccount(db, a, { kakaoMapUserId: "km1" }, now)).rejects.toBeInstanceOf(
      AccountGoneError,
    );
    expect(await boundKakaoMapAccount(db, a)).toBeNull();
    await bindKakaoMapAccount(db, b, { kakaoMapUserId: "km1" }, now);
    expect(await boundKakaoMapAccount(db, b)).toEqual({ kakaoMapUserId: "km1", nickname: null });
  });
});

it("recognises D1's wording of the unique violation", async () => {
  const d1Error = new Error(
    "D1_ERROR: UNIQUE constraint failed: kakao_map_accounts.kakao_map_user_id: SQLITE_CONSTRAINT",
  );
  const insert = {
    columns: () => insert,
    expression: () => insert,
    onConflict: () => insert,
    executeTakeFirst: () => Promise.reject(d1Error),
  };
  const db = {
    kysely: { insertInto: () => insert },
  } as unknown as Parameters<typeof bindKakaoMapAccount>[0];
  await expect(bindKakaoMapAccount(db, "u", { kakaoMapUserId: "km" }, now)).rejects.toBeInstanceOf(
    KakaoMapAccountTakenError,
  );
});
