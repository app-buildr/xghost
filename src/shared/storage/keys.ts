/**
 * Clés de stockage (tout est dans `storage.local`). Les données de compte sont préfixées
 * par l'id X du compte (§ 5.4).
 */
export const keys = {
  settings: 'settings',
  accounts: 'accounts',
  selectedAccount: 'sel',
  status: 'status',
  scanTab: 'scanTab',
  /** Historique complet (départs et arrivées, format compact). */
  events: (accountId: string) => `acc:${accountId}:events`,
  ignored: (accountId: string) => `acc:${accountId}:ign`,
  snapshot: (accountId: string) => `acc:${accountId}:snapshot`,
  profiles: (accountId: string) => `acc:${accountId}:profiles`,
  scanJob: (accountId: string) => `acc:${accountId}:job`,
  scanProgress: (accountId: string) => `acc:${accountId}:progress`,
  partialScan: (accountId: string) => `acc:${accountId}:partial`,
  suspicious: (accountId: string) => `acc:${accountId}:suspicious`,
  lastVisit: (accountId: string) => `acc:${accountId}:visit`,
} as const;

export const isAccountKey = (key: string, accountId: string) => key.startsWith(`acc:${accountId}:`);

/** Id du compte d'une clé `acc:<id>:…`, sinon `undefined`. */
export const accountIdOfKey = (key: string): string | undefined => /^acc:(\d{1,20}):/.exec(key)?.[1];
