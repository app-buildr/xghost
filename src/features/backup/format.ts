import { compactEventsOf, isCompactEvent } from '@/domain/events/codec';
import { MAX_TOTALS } from '@/features/followers-sync/model';
import { sanitizeSettings } from '@/features/settings/sanitize';
import { isNewer } from '@/shared/utils/version';
import { AVATAR, HANDLE, ID } from '@/shared/x-urls';
import { accountIdOfKey, accountSuffixOfKey, isTransientAccountKey, keys, type BackupSuffix } from '@/shared/storage/keys';
import { isRecord } from '@/shared/utils/guards';
import { fromLegacyLayout } from '@/shared/storage/legacy';
import type { BackupError, ScanCoverage, Snapshot, TrackedAccount } from '@/shared/types';

/**
 * Format du fichier de sauvegarde et validation stricte (fonctions pures, testées).
 *
 * Le fichier reprend le stockage de l'extension (`data`). À l'import, chaque clé doit
 * correspondre à un motif connu et chaque valeur avoir la forme attendue : le moindre écart
 * fait refuser le fichier entier, avant toute modification des données.
 *
 * Format 1 (xGhost 1.0) : deux zones `sync` et `local`, historique découpé en morceaux.
 * Toujours accepté : converti au format actuel avant validation.
 */

export const BACKUP_APP = 'xghost';
export const BACKUP_FORMAT = 2;
const LEGACY_FORMAT = 1;
/** Taille maximale d'une sauvegarde (fichier et message vers le service worker). */
export const MAX_BACKUP_BYTES = 50 * 1024 * 1024;

export interface Backup {
  app: typeof BACKUP_APP;
  format: typeof BACKUP_FORMAT;
  /** Version de xGhost qui a produit la sauvegarde. */
  version: string;
  exportedAt: number;
  data: Record<string, unknown>;
}

export type BackupCheck = { ok: true; backup: Backup } | { ok: false; error: BackupError };

/**
 * État propre à cette installation, jamais exporté ni écrasé par un import : scan en cours,
 * onglet de scan, statut.
 */
const TRANSIENT_KEYS = new Set<string>([keys.scanTab, keys.status, keys.dismissed, keys.unseen]);
export const isTransientKey = (key: string) => TRANSIENT_KEYS.has(key) || isTransientAccountKey(key);

// --- Validation des valeurs ---------------------------------------------------------

/** Valeur refusée : interrompt la validation du fichier entier. */
class Invalid extends Error {}
const fail = (): never => {
  throw new Invalid();
};

const record = (v: unknown): Record<string, unknown> => (isRecord(v) ? v : fail());
const finite = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : fail());
const count = (v: unknown): number => (Number.isSafeInteger(v) && (v as number) >= 0 ? (v as number) : fail());
const bool = (v: unknown): boolean => (typeof v === 'boolean' ? v : fail());
const id = (v: unknown): string => (typeof v === 'string' && ID.test(v) ? v : fail());
const text = (v: unknown, max: number): string => (typeof v === 'string' && v.length <= max ? v : fail());
const optional = <T>(v: unknown, check: (v: unknown) => T): T | undefined => (v === undefined ? undefined : check(v));
const list = <T>(v: unknown, check: (v: unknown) => T, max: number): T[] =>
  Array.isArray(v) && v.length <= max ? v.map(check) : fail();
/** Enlève les champs `undefined` (objets reconstruits champ par champ). */
const compact = <T extends object>(o: T): T =>
  Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;

/** Limites larges : au-delà, le fichier ne peut pas venir de xGhost. */
const MAX_FOLLOWERS = 5_000_000;
const MAX_EVENTS = 1_000_000;

/** @handle d'un compte : un handle X, ou l'id du compte tant que le profil n'a pas été lu. */
const handleOf = (v: unknown, accountId: string): string =>
  typeof v === 'string' && (HANDLE.test(v) || v === accountId) ? v : fail();

function coverage(v: unknown): ScanCoverage {
  const c = record(v);
  return compact({
    at: finite(c.at),
    detected: count(c.detected),
    scanned: count(c.scanned),
    complete: bool(c.complete),
    stoppedAt: optional(c.stoppedAt, count),
  });
}

function account(v: unknown, accountId: string): TrackedAccount {
  const a = record(v);
  if (a.id !== accountId) fail();
  const pending = optional(a.pending, (p) => {
    const r = record(p);
    return compact({ count: count(r.count), at: finite(r.at), full: optional(r.full, bool) });
  });
  const lastQuick = optional(a.lastQuick, (q) => {
    const r = record(q);
    return compact({
      at: finite(r.at),
      arrivals: count(r.arrivals),
      departed: optional(r.departed, count),
      missing: count(r.missing),
      overflow: bool(r.overflow),
      total: optional(r.total, count),
      staleRuns: optional(r.staleRuns, count),
      job: optional(r.job, finite),
    });
  });
  return compact({
    id: accountId,
    handle: handleOf(a.handle, accountId),
    name: optional(a.name, (n) => text(n, 100)),
    avatar: optional(a.avatar, (v) => (typeof v === 'string' && AVATAR.test(v) ? v : fail())),
    addedAt: finite(a.addedAt),
    baselineAt: optional(a.baselineAt, finite),
    lastScanAt: optional(a.lastScanAt, finite),
    followersCount: optional(a.followersCount, count),
    mutualsOnly: a.mutualsOnly === undefined ? false : bool(a.mutualsOnly),
    pending,
    lastScan: optional(a.lastScan, coverage),
    quickSinceFull: optional(a.quickSinceFull, count),
    quickFailures: optional(a.quickFailures, count),
    lastQuick,
    baselineRetry: optional(a.baselineRetry, (r) => {
      const v = record(r);
      return { attempts: count(v.attempts), at: finite(v.at) };
    }),
    limit: optional(a.limit, (l) => {
      const v = record(l);
      return { count: count(v.count), at: finite(v.at) };
    }),
  });
}

function accounts(v: unknown): Record<string, TrackedAccount> {
  return Object.fromEntries(Object.entries(record(v)).map(([key, a]) => [id(key), account(a, key)]));
}

/** Profils mis en cache (abonnés) : mêmes formats que ceux acceptés depuis x.com. */
function profiles(v: unknown): Record<string, unknown> {
  const entries = Object.entries(record(v));
  if (entries.length > MAX_FOLLOWERS) fail();
  return Object.fromEntries(
    entries.map(([key, p]) => {
      const r = record(p);
      const avatar = optional(r.avatar, (a) => (typeof a === 'string' && AVATAR.test(a) ? a : fail()));
      const handle = typeof r.handle === 'string' && HANDLE.test(r.handle) ? r.handle : fail();
      return [id(key), compact({ handle, name: text(r.name, 100), avatar, following: bool(r.following) })];
    }),
  );
}

function snapshot(v: unknown): Snapshot {
  const s = record(v);
  return compact({
    at: finite(s.at),
    ids: list(s.ids, id, MAX_FOLLOWERS),
    total: count(s.total),
    xTotal: optional(s.xTotal, count),
    top: optional(s.top, (t) => list(t, id, 1000)),
    ordered: optional(s.ordered, bool),
  });
}

function partial(v: unknown): unknown {
  const p = record(v);
  if (p.kind !== 'baseline' && p.kind !== 'check') fail();
  return { kind: p.kind, at: finite(p.at), expectedTotal: count(p.expectedTotal), collected: profiles(p.collected) };
}

const events = (v: unknown, max: number): unknown[] =>
  Array.isArray(v) && v.length <= max && v.every(isCompactEvent) ? compactEventsOf(v) : fail();

/** Validateurs des clés propres à un compte (`acc:<id>:<suffixe>`) : une clé sauvegardée oubliée ici ne compile pas. */
const ACCOUNT_KEYS: Record<BackupSuffix, (v: unknown) => unknown> = {
  events: (v) => events(v, MAX_EVENTS),
  repaired: (v) => events(v, MAX_EVENTS),
  ign: (v) => list(v, id, 100_000),
  snapshot,
  profiles,
  partial,
  suspicious: (v) => (count(v) <= 100 ? v : fail()),
  totals: (v) => list(v, (p) => (Array.isArray(p) && p.length === 2 ? [finite(p[0]), count(p[1])] : fail()), MAX_TOTALS),
  visit: finite,
};

/**
 * Clé que xGhost sauvegarde : réglages, comptes, compte sélectionné et données de compte connues.
 * Toute autre clé (ancienne version, état passager) reste hors du fichier.
 */
export function isBackupKey(key: string): boolean {
  if (isTransientKey(key)) return false;
  if (key === keys.settings || key === keys.accounts || key === keys.selectedAccount) return true;
  const suffix = accountSuffixOfKey(key);
  return suffix !== undefined && Object.hasOwn(ACCOUNT_KEYS, suffix);
}

/** Scan incomplet : jetable, et aussi lourd que le cache des profils. Accepté à l'import, jamais exporté. */
const isPartialKey = (key: string) => key.endsWith(':partial');

/** Clés du stockage retenues pour la sauvegarde. */
export const backupItems = (items: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(items).filter(([key]) => isBackupKey(key) && !isPartialKey(key)));

/** Taille réelle en octets d'une sauvegarde sérialisée. */
export const byteLength = (json: string): number => new TextEncoder().encode(json).length;

/** Valide une clé et sa valeur ; renvoie la valeur nettoyée. */
function item(key: string, value: unknown): unknown {
  if (key === keys.settings) return sanitizeSettings(record(value));
  if (key === keys.accounts) return accounts(value);
  if (key === keys.selectedAccount) return id(value);
  const suffix = accountSuffixOfKey(key);
  const check = suffix && Object.hasOwn(ACCOUNT_KEYS, suffix) ? ACCOUNT_KEYS[suffix as BackupSuffix] : undefined;
  return check ? check(value) : fail();
}

function data(items: Record<string, unknown>): Record<string, unknown> {
  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(items)) {
    // État propre à l'installation (ou ancienne sauvegarde qui le contenait) : ignoré.
    if (isTransientKey(key)) continue;
    clean[key] = item(key, value);
  }
  // L'import remplace tout : un fichier sans compte effacerait toutes les données.
  const tracked = clean[keys.accounts];
  if (!isRecord(tracked) || Object.keys(tracked).length === 0) fail();
  // Données d'un compte retiré : inaccessibles, elles ne font pas refuser le fichier.
  for (const key of Object.keys(clean)) {
    const accountId = accountIdOfKey(key);
    if (accountId !== undefined && !Object.hasOwn(tracked as object, accountId)) delete clean[key];
  }
  return clean;
}

export interface BackupSummary {
  handles: string[];
  events: number;
  exportedAt: number;
}

/** Contenu d'une sauvegarde lue, pour décider en connaissance de cause. `undefined` si elle est illisible. */
export function summarizeBackup(raw: unknown, installed: string): BackupSummary | undefined {
  const check = validateBackup(raw, installed);
  if (!check.ok) return undefined;
  const { data: items, exportedAt } = check.backup;
  const events = Object.entries(items)
    .filter(([key]) => key.endsWith(':events'))
    .reduce((sum, [, list]) => sum + (list as unknown[]).length, 0);
  const handles = Object.values(items[keys.accounts] as Record<string, TrackedAccount>).map((a) => a.handle);
  return { handles, events, exportedAt };
}

/**
 * Vérifie et nettoie une sauvegarde. Refuse un fichier d'une autre application, d'un autre
 * format, produit par une version plus récente de xGhost, ou dont une seule valeur est invalide.
 */
export function validateBackup(raw: unknown, installed: string): BackupCheck {
  try {
    const b = record(raw);
    if (b.app !== BACKUP_APP || (b.format !== BACKUP_FORMAT && b.format !== LEGACY_FORMAT)) {
      return { ok: false, error: 'invalid' };
    }
    const version = text(b.version, 20);
    if (isNewer(version, installed)) return { ok: false, error: 'newer' };
    // Format 1 : la valeur synchronisée l'emportait sur la copie locale, comme à la lecture.
    const items = b.format === LEGACY_FORMAT ? fromLegacyLayout({ ...record(b.local), ...record(b.sync) }) : record(b.data);
    return {
      ok: true,
      backup: { app: BACKUP_APP, format: BACKUP_FORMAT, version, exportedAt: finite(b.exportedAt), data: data(items) },
    };
  } catch (err) {
    if (err instanceof Invalid) return { ok: false, error: 'invalid' };
    throw err;
  }
}
