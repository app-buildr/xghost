import { localKv, syncKv } from '@/shared/storage/kv';
import { keys } from '@/shared/storage/keys';
import type { TrackedAccount } from '@/shared/types';

/** Comptes X suivis (sync), comptes ignorés par compte (sync), compte sélectionné (local). */

export type AccountsMap = Record<string, TrackedAccount>;

/** Le @handle est connu (avant la première lecture du profil, `handle` vaut l'id du compte). */
export const hasKnownHandle = (a: Pick<TrackedAccount, 'id' | 'handle'>) => !!a.handle && a.handle !== a.id;

export async function loadAccounts(): Promise<AccountsMap> {
  return (await syncKv.get<AccountsMap>(keys.accounts)) ?? {};
}

let queue: Promise<unknown> = Promise.resolve();

/** Mise à jour sérialisée de la liste des comptes. */
export function updateAccounts(mutate: (accounts: AccountsMap) => AccountsMap | void): Promise<AccountsMap> {
  const run = queue.then(async () => {
    const accounts = await loadAccounts();
    const next = mutate(accounts) ?? accounts;
    await syncKv.set({ [keys.accounts]: next });
    return next;
  });
  queue = run.catch(() => undefined);
  return run;
}

export const patchAccount = (id: string, patch: Partial<TrackedAccount>) =>
  updateAccounts((accounts) => {
    const current = accounts[id];
    if (current) accounts[id] = { ...current, ...patch };
  });

export async function loadIgnored(accountId: string): Promise<Set<string>> {
  return new Set((await syncKv.get<string[]>(keys.ignored(accountId))) ?? []);
}

export async function setIgnored(accountId: string, profileId: string, ignored: boolean): Promise<void> {
  const set = await loadIgnored(accountId);
  if (ignored) set.add(profileId);
  else set.delete(profileId);
  await syncKv.set({ [keys.ignored(accountId)]: [...set] });
}

export async function getSelectedAccountId(): Promise<string | undefined> {
  return localKv.get<string>(keys.selectedAccount);
}

export async function setSelectedAccountId(id: string): Promise<void> {
  await localKv.set({ [keys.selectedAccount]: id });
}

export async function getMachineId(): Promise<string> {
  let id = await localKv.get<string>(keys.machineId);
  if (!id) {
    id = crypto.randomUUID();
    await localKv.set({ [keys.machineId]: id });
  }
  return id;
}
