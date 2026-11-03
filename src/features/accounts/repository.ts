import { createSerialQueue } from '@/shared/utils/serial';
import { ID } from '@/features/x-api/parse';
import { localKv } from '@/shared/storage/kv';
import { isRecord } from '@/shared/utils/guards';
import { keys } from '@/shared/storage/keys';
import type { TrackedAccount } from '@/shared/types';

/** Comptes X suivis, comptes ignorés par compte, compte sélectionné. */

export type AccountsMap = Record<string, TrackedAccount>;

/** Le @handle est connu (avant la première lecture du profil, `handle` vaut l'id du compte). */
/**
 * Choix de démarrage fait (§ 3.3) : un compte au moins a sa référence, obtenue par une
 * synchronisation ou par l'import d'une sauvegarde. Seule définition, partagée par le service
 * worker, l'onboarding et la popup.
 */
export const isOnboarded = (accounts: readonly Pick<TrackedAccount, 'baselineAt'>[] | AccountsMap): boolean =>
  (Array.isArray(accounts) ? accounts : Object.values(accounts)).some((a) => !!a.baselineAt);

export const hasKnownHandle = (a: Pick<TrackedAccount, 'id' | 'handle'>) => !!a.handle && a.handle !== a.id;


/**
 * Comptes suivis. Lecture défensive : une entrée corrompue (quelle qu'en soit l'origine)
 * est écartée au lieu de faire planter les interfaces ou le service worker.
 */
export async function loadAccounts(): Promise<AccountsMap> {
  const raw = await localKv.get<unknown>(keys.accounts);
  if (!isRecord(raw)) return {};
  const accounts: AccountsMap = {};
  for (const [id, a] of Object.entries(raw)) {
    if (!ID.test(id) || !isRecord(a) || a.id !== id || typeof a.handle !== 'string') continue;
    accounts[id] = {
      ...(a as unknown as TrackedAccount),
      addedAt: Number.isFinite(a.addedAt) ? (a.addedAt as number) : 0,
      mutualsOnly: a.mutualsOnly === true,
    };
  }
  return accounts;
}

const writes = createSerialQueue();
/** Attend la fin des écritures en file (import d'une sauvegarde). */
export const settleWrites = (): Promise<void> => writes.idle();

/** Mise à jour sérialisée de la liste des comptes. */
export function updateAccounts(mutate: (accounts: AccountsMap) => AccountsMap | void): Promise<AccountsMap> {
  return writes.run(async () => {
    const accounts = await loadAccounts();
    const next = mutate(accounts) ?? accounts;
    await localKv.set({ [keys.accounts]: next });
    return next;
  });
}

export const patchAccount = (id: string, patch: Partial<TrackedAccount>) =>
  updateAccounts((accounts) => {
    const current = accounts[id];
    if (current) accounts[id] = { ...current, ...patch };
  });

export async function loadIgnored(accountId: string): Promise<Set<string>> {
  const raw = await localKv.get<unknown>(keys.ignored(accountId));
  return new Set(Array.isArray(raw) ? raw.filter((id): id is string => typeof id === 'string' && ID.test(id)) : []);
}

export async function setIgnored(accountId: string, profileId: string, ignored: boolean): Promise<void> {
  const set = await loadIgnored(accountId);
  if (ignored) set.add(profileId);
  else set.delete(profileId);
  await localKv.set({ [keys.ignored(accountId)]: [...set] });
}

export async function getSelectedAccountId(): Promise<string | undefined> {
  return localKv.get<string>(keys.selectedAccount);
}

export async function setSelectedAccountId(id: string): Promise<void> {
  await localKv.set({ [keys.selectedAccount]: id });
}
