import { beforeEach, describe, expect, it } from 'vitest';
import { decodeEvent, encodeEvent } from '@/domain/events/codec';
import { loadEvents, updateEvents } from '@/features/events/repository';
import { unseenCountsByAccount } from '@/features/events/unseen';
import { loadProfiles, saveProfiles } from '@/features/followers-sync/repository';
import { keys } from '@/shared/storage/keys';
import type { TrackedAccount } from '@/shared/types';
import { installFakeChrome, type FakeChrome } from '@/test/fake-chrome';
import { importBackup } from './backup';
import { exportBackup } from './export';

const account: TrackedAccount = { id: '42', handle: 'moi', addedAt: 1, mutualsOnly: false };
const stored = [0, '5', 'parti', 1_700_000_000, 0, 0, 0] as const;

let fake: FakeChrome;

beforeEach(async () => {
  fake = installFakeChrome();
  await chrome.storage.local.set({ [keys.accounts]: { '42': account } });
});

describe('format de stockage', () => {
  it('lit un historique écrit avant le format texte', async () => {
    await chrome.storage.local.set({ [keys.events('42')]: [stored] });
    expect((await loadEvents('42')).map((e) => e.handle)).toEqual(['parti']);
  });

  it('une écriture passe au format texte, relu à l’identique', async () => {
    await chrome.storage.local.set({ [keys.events('42')]: [stored] });
    await updateEvents('42', (events) => events);
    expect(typeof fake.store.get(keys.events('42'))).toBe('string');
    expect((await loadEvents('42')).map((e) => e.handle)).toEqual(['parti']);
  });

  it('un texte illisible lève une erreur au lieu d’effacer l’historique', async () => {
    await chrome.storage.local.set({ [keys.events('42')]: '[cassé' });
    await expect(updateEvents('42', () => [])).rejects.toThrow();
    expect(fake.store.get(keys.events('42'))).toBe('[cassé');
  });

  it('lit les profils dans les deux formats', async () => {
    const profiles = { '5': { handle: 'a', name: 'A', following: false } };
    await chrome.storage.local.set({ [keys.profiles('42')]: profiles });
    expect(await loadProfiles('42')).toEqual(profiles);
    await saveProfiles('42', profiles);
    expect(await loadProfiles('42')).toEqual(profiles);
  });
});

describe('export', () => {
  it('garde le format de sauvegarde, quel que soit le format stocké', async () => {
    const event = decodeEvent([...stored]);
    await updateEvents('42', () => [event]);
    await saveProfiles('42', { '5': { handle: 'a', name: 'A', following: false } });
    const { data } = await exportBackup();
    expect(data[keys.events('42')]).toEqual([encodeEvent(event)]);
    expect(data[keys.profiles('42')]).toEqual({ '5': { handle: 'a', name: 'A', following: false } });
    expect(Object.keys(data)).not.toContain(keys.unseen);
  });

  it('une sauvegarde exportée se réimporte à l’identique', async () => {
    await chrome.storage.local.set({ [keys.selectedAccount]: '42', [keys.settings]: { badge: false } });
    await updateEvents('42', () => [decodeEvent([...stored])]);
    const backup = JSON.parse(JSON.stringify(await exportBackup())) as unknown;
    await chrome.storage.local.remove(keys.events('42'));
    expect((await importBackup(backup)).ok).toBe(true);
    expect((await loadEvents('42')).map((e) => e.handle)).toEqual(['parti']);
    expect(fake.store.get(keys.selectedAccount)).toBe('42');
  });
});

describe('compteurs de non-vus', () => {
  it('suivent les écritures de l’historique', async () => {
    await updateEvents('42', () => [decodeEvent([...stored])]);
    expect(fake.store.get(keys.unseen)).toEqual({ '42': 1 });
    expect(await unseenCountsByAccount([account])).toEqual({ '42': 1 });
  });

  it('sans compteur enregistré : calculés depuis l’historique', async () => {
    await chrome.storage.local.set({ [keys.events('42')]: [stored] });
    expect(await unseenCountsByAccount([account])).toEqual({ '42': 1 });
  });

  it('import : les compteurs de l’ancien historique sont effacés', async () => {
    await updateEvents('42', () => [decodeEvent([...stored])]);
    const backup = { app: 'xghost', format: 2, version: '1.0.0', exportedAt: 1, data: { [keys.accounts]: { '42': account } } };
    await importBackup(backup);
    expect(fake.store.has(keys.unseen)).toBe(false);
  });
});
