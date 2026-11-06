import { ID_PATTERN } from '@/shared/x-urls';

/**
 * Clés de stockage (tout est dans `storage.local`). Les données de compte sont préfixées
 * par l'id X du compte (§ 5.4).
 *
 * Toutes les clés d'un compte sont décrites dans `ACCOUNT_KEYS` : la sauvegarde, le retrait d'un
 * compte et le rechargement des interfaces en dérivent. Ne jamais changer un suffixe : il est
 * écrit dans le stockage et dans les sauvegardes.
 * - `backup` : exportée et validée à l'import ; sinon, état propre à cette installation ;
 * - `display` : son changement recharge l'historique affiché.
 */
const ACCOUNT_KEYS = {
  /** Historique complet (départs et arrivées, format compact). */
  events: { suffix: 'events', backup: true, display: true },
  ignored: { suffix: 'ign', backup: true, display: true },
  snapshot: { suffix: 'snapshot', backup: true, display: false },
  profiles: { suffix: 'profiles', backup: true, display: true },
  scanJob: { suffix: 'job', backup: false, display: false },
  scanProgress: { suffix: 'progress', backup: false, display: false },
  partialScan: { suffix: 'partial', backup: true, display: false },
  suspicious: { suffix: 'suspicious', backup: true, display: false },
  /** Ancienne date de dernière visite de la popup (plus utilisée ; effacée avec le compte). */
  lastVisit: { suffix: 'visit', backup: true, display: false },
  /** Mouvements retirés de l'historique par le nettoyage des faux départs (conservés, format compact). */
  repaired: { suffix: 'repaired', backup: true, display: false },
  /** Total d'abonnés annoncé par X, un point par jour (courbe des abonnés). */
  totals: { suffix: 'totals', backup: true, display: true },
} as const;

type AccountKeySpec = (typeof ACCOUNT_KEYS)[keyof typeof ACCOUNT_KEYS];
/** Suffixe d'une clé de compte sauvegardée : la validation de l'import doit les couvrir tous. */
export type BackupSuffix = Extract<AccountKeySpec, { backup: true }>['suffix'];

const specs: readonly AccountKeySpec[] = Object.values(ACCOUNT_KEYS);
const accountKey = (accountId: string, suffix: string) => `acc:${accountId}:${suffix}`;
const keyOf = (suffix: AccountKeySpec['suffix']) => (accountId: string) => accountKey(accountId, suffix);

export const keys = {
  settings: 'settings',
  accounts: 'accounts',
  selectedAccount: 'sel',
  status: 'status',
  scanTab: 'scanTab',
  /** Compte retiré alors qu'il était connecté sur x.com : pas de ré-ajout automatique. */
  dismissed: 'dismissed',
  /** Départs non vus par compte (compteurs déduits de l'historique, jamais sauvegardés). */
  unseen: 'unseen',
  events: keyOf(ACCOUNT_KEYS.events.suffix),
  ignored: keyOf(ACCOUNT_KEYS.ignored.suffix),
  snapshot: keyOf(ACCOUNT_KEYS.snapshot.suffix),
  profiles: keyOf(ACCOUNT_KEYS.profiles.suffix),
  scanJob: keyOf(ACCOUNT_KEYS.scanJob.suffix),
  scanProgress: keyOf(ACCOUNT_KEYS.scanProgress.suffix),
  partialScan: keyOf(ACCOUNT_KEYS.partialScan.suffix),
  suspicious: keyOf(ACCOUNT_KEYS.suspicious.suffix),
  lastVisit: keyOf(ACCOUNT_KEYS.lastVisit.suffix),
  repaired: keyOf(ACCOUNT_KEYS.repaired.suffix),
  totals: keyOf(ACCOUNT_KEYS.totals.suffix),
} as const;

const ACCOUNT_KEY = new RegExp(`^acc:(${ID_PATTERN}):([a-z]+)$`);

/** Id du compte d'une clé `acc:<id>:…`, sinon `undefined`. */
export const accountIdOfKey = (key: string): string | undefined => ACCOUNT_KEY.exec(key)?.[1];

/** Suffixe d'une clé `acc:<id>:…`, sinon `undefined`. */
export const accountSuffixOfKey = (key: string): string | undefined => ACCOUNT_KEY.exec(key)?.[2];

const specOf = (key: string) => specs.find((s) => s.suffix === accountSuffixOfKey(key));

/** Toutes les clés d'un compte (retrait du compte). */
export const accountKeysOf = (accountId: string): string[] => specs.map((s) => accountKey(accountId, s.suffix));

/** État d'un compte propre à cette installation : jamais exporté ni écrasé par un import. */
export const isTransientAccountKey = (key: string): boolean => specOf(key)?.backup === false;

/** Clé d'un compte dont le changement recharge l'historique affiché. */
export const isDisplayKey = (key: string, accountId: string): boolean =>
  accountIdOfKey(key) === accountId && specOf(key)?.display === true;

/** Clés sauvegardées stockées en texte JSON (voir `encodeStored`) : les autres chaînes restent des chaînes. */
export const isStoredAsText = (key: string): boolean => {
  const suffix = accountSuffixOfKey(key);
  return suffix === ACCOUNT_KEYS.events.suffix || suffix === ACCOUNT_KEYS.profiles.suffix;
};

/** État léger d'un scan (`acc:<id>:progress`). */
export const isProgressKey = (key: string): boolean => accountSuffixOfKey(key) === ACCOUNT_KEYS.scanProgress.suffix;
