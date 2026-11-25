/**
 * What this device remembers per account, outside its database. Removing an account from the
 * device removes all of these; device-wide keys (language, config) stay.
 */
export const deviceKeys = {
  visibleLists: (userId: string) => `mm.visibleLists.${userId}`,
  showPrevious: (userId: string) => `mm.showPrevious.${userId}`,
  mapProvider: (userId: string) => `mm.mapProvider.${userId}`,
  name: (userId: string) => `mm.name.${userId}`,
  mapFit: (userId: string) => `mm.mapFit.${userId}`,
};

/** Every per-account key for this account. */
export const accountDeviceKeys = (userId: string): string[] =>
  Object.values(deviceKeys).map((key) => key(userId));
