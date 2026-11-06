import { beforeEach, describe, expect, it } from 'vitest';
import { keys } from '@/shared/storage/keys';
import { installFakeChrome, type FakeChrome } from '@/test/fake-chrome';
import { importBackup } from './backup';

const account = (id: string) => ({ id, handle: 'moi', addedAt: 1, mutualsOnly: false });
const file = (data: Record<string, unknown>) => ({ app: 'xghost', format: 2, version: '1.0.0', exportedAt: 1_700_000_000_000, data });

let fake: FakeChrome;

beforeEach(async () => {
  fake = installFakeChrome();
  await chrome.storage.local.set({
    [keys.accounts]: { '1': account('1') },
    [keys.events('1')]: [[0, '5', 'parti', 1_700_000_000, 0, 0, 1]],
    [keys.status]: { session: 'ok', updatedAt: 1 },
  });
});

describe('importBackup', () => {
  it('remplace les données et supprime les clés absentes du fichier', async () => {
    const result = await importBackup(file({ [keys.accounts]: { '2': account('2') } }));
    expect(result.ok).toBe(true);
    expect(fake.store.has(keys.events('1'))).toBe(false);
    expect(Object.keys(fake.store.get(keys.accounts) as object)).toEqual(['2']);
  });

  it("garde l'état propre à l'installation", async () => {
    await importBackup(file({ [keys.accounts]: { '2': account('2') } }));
    expect(fake.store.has(keys.status)).toBe(true);
  });

  it('fichier invalide : rien ne change', async () => {
    const result = await importBackup(file({ inconnu: 1 }));
    expect(result).toEqual({ ok: false, error: 'invalid' });
    expect(fake.store.has(keys.events('1'))).toBe(true);
  });

  it("échec de l'écriture : l'état d'avant est rétabli", async () => {
    fake.failNextSet();
    const result = await importBackup(file({ [keys.accounts]: { '2': account('2') } }));
    expect(result).toEqual({ ok: false, error: 'failed' });
    expect(fake.store.has(keys.events('1'))).toBe(true);
    expect(Object.keys(fake.store.get(keys.accounts) as object)).toEqual(['1']);
  });

  it('fichier sans compte : refusé, rien n’est effacé', async () => {
    const result = await importBackup(file({}));
    expect(result).toEqual({ ok: false, error: 'invalid' });
    expect(fake.store.has(keys.events('1'))).toBe(true);
  });
});
