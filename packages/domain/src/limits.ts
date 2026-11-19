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
} as const;
