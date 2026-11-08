import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keys } from '@/shared/storage/keys';
import type { FollowCheck, FollowCheckResult, TrackedAccount } from '@/shared/types';
import { installFakeChrome, type FakeChrome } from '@/test/fake-chrome';

const ID = '42';
const account: TrackedAccount = { id: ID, handle: 'moi', addedAt: 1, mutualsOnly: false, followersCount: 200, baselineAt: 1 };

type Engine = typeof import('./scan-engine');
let engine: Engine;
let fake: FakeChrome;
const done = vi.fn(async (_accountId: string, _results: FollowCheckResult[], _nextAt?: number) => undefined);
const hooks = {
  onComplete: vi.fn(async () => undefined),
  onFinished: vi.fn(async () => undefined),
  onInterrupted: vi.fn(async () => undefined),
  onStateChange: vi.fn(async () => undefined),
  scheduleResume: vi.fn(async () => undefined),
  onFollowerLimit: vi.fn(async () => undefined),
  onFollowerLimitCleared: vi.fn(async () => undefined),
  onFollowCheckDone: done,
};

const item = (i: number): FollowCheck => ({ eventId: `d${i}`, profileId: String(500 + i), handle: `parti${i}` });
const queue = (n: number) => Array.from({ length: n }, (_, i) => item(i));

const tabId = () => (fake.store.get(keys.scanTab) as { tabId: number } | undefined)?.tabId;
const tabUrl = () => fake.tabs.get(tabId()!)?.url;

/** Réponse du profil `profileId`, telle que x.com la reçoit. */
function profile(profileId: string, following: boolean | undefined, over: { rateRemaining?: number } = {}) {
  const relationship = following === undefined ? {} : { relationship_perspectives: { following } };
  return engine.handleTabEvent(
    {
      xgTab: 'response',
      op: 'UserByRestId',
      url: `https://x.com/i/api/graphql/abc/UserByRestId?variables=${encodeURIComponent(JSON.stringify({ userId: profileId }))}`,
      status: 200,
      body: JSON.stringify({
        data: { user: { result: { __typename: 'User', rest_id: profileId, core: { screen_name: `h${profileId}`, name: 'Nom' }, ...relationship } } },
      }),
      rateRemaining: over.rateRemaining,
    },
    tabId()!,
  );
}

beforeEach(async () => {
  vi.useFakeTimers();
  vi.resetModules();
  Object.values(hooks).forEach((h) => h.mockClear());
  fake = installFakeChrome();
  for (const [name, value] of [['auth_token', 'a'], ['ct0', 'b'], ['twid', `u%3D${ID}`]] as const) fake.cookies.set(name, value);
  await chrome.storage.local.set({ [keys.accounts]: { [ID]: account } });
  engine = await import('./scan-engine');
  engine.setScanHooks(hooks as never);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('vérification du follow back des départs', () => {
  it('rien en attente : aucun onglet', async () => {
    expect(await engine.startFollowCheck(ID)).toBe('empty');
    expect(fake.tabs.size).toBe(0);
  });

  it('ouvre le profil du compte parti par son id, dans un onglet épinglé reconnu comme onglet de scan', async () => {
    await chrome.storage.local.set({ [keys.followChecks(ID)]: queue(1) });
    expect(await engine.startFollowCheck(ID)).toBe('started');
    expect(fake.tabs.get(tabId()!)).toMatchObject({ pinned: true });
    expect(tabUrl()).toMatch(/^https:\/\/x\.com\/i\/user\/500#/);
    expect(await engine.isScanTab(tabId()!)).toBe(true);
  });

  it('lit « je le suis » sur le profil, ferme l’onglet et vide la file', async () => {
    await chrome.storage.local.set({ [keys.followChecks(ID)]: queue(1) });
    await engine.startFollowCheck(ID);
    const tab = tabId()!;
    await profile('500', true);
    expect(done).toHaveBeenCalledTimes(1);
    const [, results, nextAt] = done.mock.calls[0]!;
    expect(results).toEqual([expect.objectContaining({ eventId: 'd0', profileId: '500', following: true })]);
    expect(nextAt).toBeUndefined();
    expect(fake.tabs.has(tab)).toBe(false);
    expect(fake.store.has(keys.scanTab)).toBe(false);
    expect(fake.store.has(keys.followChecks(ID))).toBe(false);
  });

  it('ignore la réponse d’un autre profil', async () => {
    await chrome.storage.local.set({ [keys.followChecks(ID)]: queue(1) });
    await engine.startFollowCheck(ID);
    await profile('999', true);
    expect(done).not.toHaveBeenCalled();
  });

  it('passe au départ suivant après une pause, et plafonne la passe', async () => {
    await chrome.storage.local.set({ [keys.followChecks(ID)]: queue(17) });
    await engine.startFollowCheck(ID);
    for (let i = 0; i < 15; i++) {
      expect(tabUrl()).toContain(`/i/user/${500 + i}#`);
      await profile(String(500 + i), i % 2 === 0);
      await vi.advanceTimersByTimeAsync(8_000);
    }
    expect(done).toHaveBeenCalledTimes(1);
    const [, results, nextAt] = done.mock.calls[0]!;
    expect(results).toHaveLength(15);
    // Deux départs attendent la passe suivante, programmée plus tard.
    expect(nextAt).toBeGreaterThan(Date.now());
    expect((fake.store.get(keys.followChecks(ID)) as FollowCheck[]).map((q) => q.eventId)).toEqual(['d15', 'd16']);
  });

  it('profil muet : retenté plus tard ; x.com muet d’affilée : passe arrêtée', async () => {
    await chrome.storage.local.set({ [keys.followChecks(ID)]: queue(3) });
    await engine.startFollowCheck(ID);
    await vi.advanceTimersByTimeAsync(25_000 + 8_000);
    expect(tabUrl()).toContain('/i/user/501#');
    await vi.advanceTimersByTimeAsync(25_000);
    expect(done).toHaveBeenCalledTimes(1);
    expect(done.mock.calls[0]![1]).toEqual([]);
    const stored = fake.store.get(keys.followChecks(ID)) as FollowCheck[];
    expect(stored.map((q) => [q.eventId, q.attempts])).toEqual([['d0', 1], ['d1', 1], ['d2', undefined]]);
  });

  it('dernière requête autorisée par X : la suite attend la levée de la limite', async () => {
    await chrome.storage.local.set({ [keys.followChecks(ID)]: queue(2) });
    await engine.startFollowCheck(ID);
    await profile('500', false, { rateRemaining: 0 });
    expect(done).toHaveBeenCalledTimes(1);
    expect(done.mock.calls[0]![2]).toBeGreaterThan(Date.now());
  });

  it('un scan est prioritaire : la vérification s’arrête, ce qui est lu est appliqué', async () => {
    await chrome.storage.local.set({ [keys.followChecks(ID)]: queue(3) });
    await engine.startFollowCheck(ID);
    const checkTab = tabId()!;
    await profile('500', true);
    await engine.startScan(account, 'check', 'user');
    expect(fake.tabs.has(checkTab)).toBe(false);
    expect(done).toHaveBeenCalledTimes(1);
    expect(done.mock.calls[0]![1]).toHaveLength(1);
    expect(tabUrl()).toMatch(/\/moi\/followers#/);
    // Scan en cours : pas de nouvelle passe.
    expect(await engine.startFollowCheck(ID)).toBe('busy');
  });

  it('onglet fermé par l’utilisateur : passe arrêtée, reprise plus tard', async () => {
    await chrome.storage.local.set({ [keys.followChecks(ID)]: queue(2) });
    await engine.startFollowCheck(ID);
    const tab = tabId()!;
    fake.tabs.delete(tab);
    await engine.handleTabRemoved(tab);
    expect(done).toHaveBeenCalledTimes(1);
    expect(done.mock.calls[0]![2]).toBeGreaterThan(Date.now());
    expect(fake.store.has(keys.scanTab)).toBe(false);
  });

  it('rien en attente, autre compte connecté : pas de nouvel essai programmé', async () => {
    fake.cookies.set('twid', 'u%3D7');
    expect(await engine.startFollowCheck(ID)).toBe('empty');
  });

  it('autre compte connecté : rien n’est ouvert', async () => {
    await chrome.storage.local.set({ [keys.followChecks(ID)]: queue(1) });
    fake.cookies.set('twid', 'u%3D7');
    expect(await engine.startFollowCheck(ID)).toBe('other-account');
    expect(fake.tabs.size).toBe(0);
  });

  it('redémarrage de Chrome : seuls les onglets épinglés en arrière-plan sur le profil vérifié sont fermés', async () => {
    const tabs = [
      { id: 900, url: 'https://x.com/i/user/500', pinned: true }, // onglet restauré, avant redirection
      { id: 901, url: 'https://x.com/parti0', pinned: true }, // onglet restauré, après redirection
      { id: 902, url: 'https://x.com/parti0', pinned: true, active: true }, // affiché : gardé
      { id: 903, url: 'https://x.com/parti0', pinned: false }, // non épinglé : gardé
      { id: 904, url: 'https://x.com/autre', pinned: true }, // autre profil : gardé
    ];
    for (const t of tabs) fake.tabs.set(t.id, t);
    await chrome.storage.local.set({
      [keys.scanTab]: { tabId: 77, accountId: ID, purpose: 'follow-check', profileId: '500', handle: 'parti0' },
    });
    await engine.closeRestoredScanTab();
    expect([...fake.tabs.keys()].sort()).toEqual([902, 903, 904]);
    expect(fake.store.has(keys.scanTab)).toBe(false);
  });

  it('retrait du compte : la passe est abandonnée sans rien appliquer', async () => {
    await chrome.storage.local.set({ [keys.followChecks(ID)]: queue(2) });
    await engine.startFollowCheck(ID);
    await engine.cancelScan(ID);
    expect(fake.tabs.size).toBe(0);
    expect(done).not.toHaveBeenCalled();
  });
});
