import { useEffect, useMemo } from 'react';
import { getSelectedAccountId, loadAccounts, setSelectedAccountId } from '@/features/accounts/repository';
import { loadSettings } from '@/features/settings/repository';
import { useStorageQuery } from '@/shared/hooks/useStorageQuery';
import { send } from '@/shared/messaging/client';
import { localKv } from '@/shared/storage/kv';
import { keys } from '@/shared/storage/keys';
import { DEFAULT_SETTINGS, type GlobalStatus, type Settings, type TrackedAccount } from '@/shared/types';

const selectAccount = (id: string) => setSelectedAccountId(id);
const updateSettings = (patch: Partial<Settings>) => send('settings:update', patch);

/** État global : comptes, compte sélectionné, réglages, état de session. */
export function useAppState() {
  const { data, loading } = useStorageQuery(
    async () => {
      const [accounts, selectedId, settings, status] = await Promise.all([
        loadAccounts(),
        getSelectedAccountId(),
        loadSettings(),
        localKv.get<GlobalStatus>(keys.status),
      ]);
      return { accounts, selectedId, settings, status };
    },
    (k) => k === keys.accounts || k === keys.selectedAccount || k === keys.settings || k === keys.status,
    [],
  );

  const accounts = useMemo(
    () => Object.values(data?.accounts ?? {}).sort((a, b) => a.addedAt - b.addedAt),
    [data?.accounts],
  );
  const selected: TrackedAccount | undefined =
    accounts.find((a) => a.id === data?.selectedId) ??
    accounts.find((a) => a.id === data?.status?.activeAccountId) ??
    accounts[0];

  // Aucun compte connu (ex. connecté à X avant l'installation) : on demande une détection.
  const noAccount = !loading && accounts.length === 0;
  useEffect(() => {
    if (noAccount) void send('session:detect', undefined).catch(() => undefined);
  }, [noAccount]);

  return {
    loading,
    accounts,
    selected,
    settings: data?.settings ?? DEFAULT_SETTINGS,
    status: data?.status,
    select: selectAccount,
    updateSettings,
  };
}
