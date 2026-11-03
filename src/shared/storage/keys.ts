/** Clés de stockage. Les données de compte sont préfixées par l'id X du compte (§ 5.4). */
export const keys = {
  // --- storage.sync (avec repli local) ---
  settings: 'settings',
  accounts: 'accounts',
  eventChunkCount: (accountId: string) => `acc:${accountId}:evn`,
  eventChunk: (accountId: string, n: number) => `acc:${accountId}:ev:${n}`,
  ignored: (accountId: string) => `acc:${accountId}:ign`,

  // --- storage.local ---
  selectedAccount: 'sel',
  machineId: 'machine',
  status: 'status',
  scanTab: 'scanTab',
  /** Dernière version publiée sur GitHub (mise à jour maison). */
  latestVersion: 'latestVersion',
  snapshot: (accountId: string) => `acc:${accountId}:snapshot`,
  profiles: (accountId: string) => `acc:${accountId}:profiles`,
  archive: (accountId: string) => `acc:${accountId}:archive`,
  scanJob: (accountId: string) => `acc:${accountId}:job`,
  scanProgress: (accountId: string) => `acc:${accountId}:progress`,
  partialScan: (accountId: string) => `acc:${accountId}:partial`,
  suspicious: (accountId: string) => `acc:${accountId}:suspicious`,
  lastVisit: (accountId: string) => `acc:${accountId}:visit`,
} as const;

export const isAccountKey = (key: string, accountId: string) => key.startsWith(`acc:${accountId}:`);
