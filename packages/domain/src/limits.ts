export const LIMITS = {
  noteBody: 20_000,
  linkUrl: 2_048,
  linkTitle: 300,
  listName: 100,
  pushMutations: 200,
  pushBytes: 1_000_000,
  pullPageRows: 500,
  importTitle: 1_000,
  importText: 5_000,
  importChunkItems: 500,
  importListItems: 5_000,
  importLists: 500,
  /** An account's nickname, in characters. */
  nickname: 40,
} as const;

/** A device clock may run ahead; client times further ahead of the server than this are refused (clock_ahead). */
export const CLOCK_ALLOWANCE_MS = 60_000;
