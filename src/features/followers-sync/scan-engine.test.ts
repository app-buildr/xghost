import { beforeEach, describe, expect, it, vi } from 'vitest';
import { keys } from '@/shared/storage/keys';
import type { ScanJob, TrackedAccount } from '@/shared/types';
import { installFakeChrome, type FakeChrome } from '@/test/fake-chrome';

const ID = '42';
const account: TrackedAccount = { id: ID, handle: 'moi', addedAt: 1, mutualsOnly: false, followersCount: 200, baselineAt: 1 };

type Engine = typeof import('./scan-engine');
let engine: Engine;
let fake: FakeChrome;
const hooks = {
  onComplete: vi.fn(async (_job: ScanJob) => undefined),
  onFinished: vi.fn(async () => undefined),
  onInterrupted: vi.fn(async (_job: ScanJob) => undefined),
  onStateChange: vi.fn(async () => undefined),
  scheduleResume: vi.fn(async () => undefined),
  onFollowerLimit: vi.fn(async () => undefined),
  onFollowerLimitCleared: vi.fn(async () => undefined),
};

const user = (id: string) => ({
  entryId: `user-${id}`,
  content: {
    itemContent: {
      user_results: { result: { __typename: 'User', rest_id: id, core: { screen_name: `u${id}`, name: `Nom ${id}` } } },
    },
  },
});

function page(ids: readonly string[], next?: string) {
  const entries: unknown[] = ids.map(user);
  if (next) entries.push({ entryId: 'cursor-bottom-1', content: { cursorType: 'Bottom', value: next } });
  return JSON.stringify({ data: { user: { result: { timeline: { timeline: { instructions: [{ entries }] } } } } } });
}

const url = (cursor?: string, userId = ID) =>
  `https://x.com/i/api/graphql/abc/Followers?variables=${encodeURIComponent(JSON.stringify({ userId, cursor }))}`;

const ids = (from: number, n: number) => Array.from({ length: n }, (_, i) => String(1000 + from + i));

let tabId: number;
const deliver = (body: string, cursor?: string, over: { status?: number; userId?: string; rateRemaining?: number } = {}) =>
  engine.handleTabEvent(
    { xgTab: 'response', op: 'Followers', url: url(cursor, over.userId), status: over.status ?? 200, body, rateRemaining: over.rateRemaining },
    tabId,
  );
const profile = (followers: number) =>
  engine.handleTabEvent(
    {
      xgTab: 'response',
      op: 'UserByScreenName',
      url: 'https://x.com/i/api/graphql/abc/UserByScreenName',
      status: 200,
      body: JSON.stringify({
        data: { user: { result: { __typename: 'User', rest_id: ID, core: { screen_name: 'moi', name: 'Moi' }, legacy: { followers_count: followers } } } },
      }),
    },
    tabId,
  );

const job = () => JSON.parse(fake.store.get(keys.scanJob(ID)) as string) as ScanJob;
const progress = () => fake.store.get(keys.scanProgress(ID)) as { collected: number; status: string; pausedReason?: string };

async function start(kind: ScanJob['kind'] = 'check', target?: number) {
  await engine.startScan(account, kind, kind === 'quick' ? 'quick' : 'user', target);
  tabId = [...fake.tabs.keys()].at(-1)!;
}

beforeEach(async () => {
  vi.resetModules();
  Object.values(hooks).forEach((h) => h.mockClear());
  fake = installFakeChrome();
  for (const [name, value] of [['auth_token', 'a'], ['ct0', 'b'], ['twid', `u%3D${ID}`]] as const) fake.cookies.set(name, value);
  await chrome.storage.local.set({ [keys.accounts]: { [ID]: account } });
  engine = await import('./scan-engine');
  engine.setScanHooks(hooks as never);
});

describe('démarrage', () => {
  it('ouvre un onglet épinglé avec le fragment, et l’enregistre', async () => {
    await start();
    expect(fake.tabs.get(tabId)).toMatchObject({ pinned: true });
    expect(fake.tabs.get(tabId)?.url).toMatch(/^https:\/\/x\.com\/moi\/followers#/);
    expect(await engine.isScanTab(tabId)).toBe(true);
    expect(await engine.isScanTab(999)).toBe(false);
  });

  it('un onglet inconnu n’est ni fermé ni adopté', async () => {
    const other = await chrome.tabs.create({ url: 'https://x.com/home' });
    await engine.handleTabEvent({ xgTab: 'ready', path: '/home' }, other.id!);
    expect(fake.tabs.has(other.id!)).toBe(true);
    expect(fake.store.has(keys.scanTab)).toBe(false);
  });

  it('sans session : mis en pause, aucun onglet', async () => {
    fake.cookies.clear();
    await engine.startScan(account, 'check', 'user');
    expect(fake.tabs.size).toBe(0);
    expect(progress().pausedReason).toBe('disconnected');
  });
});

describe('pages de la liste', () => {
  it('fusionne les pages et compte chaque abonné une fois', async () => {
    await start();
    await deliver(page(ids(0, 20), 'c1'));
    await deliver(page(ids(10, 20), 'c2'), 'c1');
    expect(progress().collected).toBe(30);
  });

  it('ignore la liste d’un autre compte', async () => {
    await start();
    await deliver(page(ids(0, 20), 'c1'), undefined, { userId: '7' });
    expect(progress().collected).toBe(0);
  });

  it('la fin de liste lance l’analyse et ferme l’onglet', async () => {
    await start();
    await profile(20);
    await deliver(page(ids(0, 20)));
    await engine.settleAnalyses();
    expect(hooks.onComplete).toHaveBeenCalledTimes(1);
    expect(hooks.onComplete.mock.calls[0]![0].reachedEnd).toBe(true);
    expect(fake.tabs.has(tabId)).toBe(false);
    expect(fake.store.has(keys.scanJob(ID))).toBe(false);
  });

  it('marque la liste relue depuis le haut', async () => {
    await start();
    await deliver(page(ids(0, 20), 'c1'));
    await deliver(page(ids(0, 20), 'c1'));
    await engine.interruptScan(ID);
    expect(hooks.onInterrupted.mock.calls[0]![0].unordered).toBe(true);
  });

  it('page vide sans curseur loin du total : pas une fin de liste', async () => {
    await start();
    await deliver(page(ids(0, 20), 'c1'));
    await deliver(page([]), 'c1');
    await engine.settleAnalyses();
    expect(hooks.onComplete).not.toHaveBeenCalled();
  });

  it('page vide sans curseur près du total : vraie fin de liste', async () => {
    await start();
    await profile(200);
    await deliver(page(ids(0, 195), 'c1'));
    await deliver(page([]), 'c1');
    await engine.settleAnalyses();
    expect(hooks.onComplete.mock.calls[0]![0].reachedEnd).toBe(true);
  });

  it('dernière requête autorisée : pause tout de suite', async () => {
    await start();
    await deliver(page(ids(0, 20), 'c1'), undefined, { rateRemaining: 0 });
    expect(progress().pausedReason).toBe('rate-limit');
  });
});

describe('erreurs de x.com', () => {
  it('429 : pause pour la limite, réveil programmé', async () => {
    await start();
    await deliver('', undefined, { status: 429 });
    expect(progress().pausedReason).toBe('rate-limit');
    expect(hooks.scheduleResume).toHaveBeenCalledTimes(1);
  });

  it('3 réponses illisibles : pause ; toujours refusée après 3 pauses : scan arrêté', async () => {
    await start();
    for (let cycle = 0; cycle < 2; cycle++) {
      for (let i = 0; i < 3; i++) await deliver('{}');
      expect(progress().pausedReason).toBe('rate-limit');
      await engine.resumeScan(ID);
    }
    for (let i = 0; i < 3; i++) await deliver('{}');
    expect(hooks.onInterrupted).toHaveBeenCalledTimes(1);
    expect(fake.tabs.has(tabId)).toBe(false);
  });

  it('une page lue remet les compteurs d’échec à zéro', async () => {
    await start();
    await deliver('{}');
    await deliver('{}');
    await deliver(page(ids(0, 20), 'c1'));
    await engine.interruptScan(ID);
    const interrupted = hooks.onInterrupted.mock.calls[0]![0];
    expect(interrupted.failedPages).toBeUndefined();
    expect(interrupted.failureCycles).toBeUndefined();
  });
});

describe('arrêt anticipé', () => {
  const previous = ids(0, 200);

  beforeEach(async () => {
    await chrome.storage.local.set({ [keys.snapshot(ID)]: { at: 1, ids: previous, total: 200, ordered: true } });
  });

  it('s’arrête après la marge, une fois les départs trouvés', async () => {
    await start('check', 1);
    await profile(199);
    const read = previous.filter((id) => id !== previous[3]);
    for (let i = 0; i < 3; i++) await deliver(page(read.slice(i * 20, i * 20 + 20), `c${i + 1}`), i ? `c${i}` : undefined);
    await engine.settleAnalyses();
    expect(hooks.onComplete).toHaveBeenCalledTimes(1);
    expect(hooks.onComplete.mock.calls[0]![0].earlyStop).toBeDefined();
  });

  it('jamais sur une liste relue depuis le haut', async () => {
    await start('check', 1);
    await profile(199);
    const read = previous.filter((id) => id !== previous[3]);
    await deliver(page(read.slice(0, 20), 'c1'));
    await deliver(page(read.slice(0, 20), 'c1'));
    for (let i = 1; i < 4; i++) await deliver(page(read.slice(i * 20, i * 20 + 20), `c${i + 1}`), `c${i}`);
    await engine.settleAnalyses();
    expect(hooks.onComplete).not.toHaveBeenCalled();
  });
});

describe('fin de scan', () => {
  it('analyse en échec : pause, liste gardée', async () => {
    hooks.onComplete.mockRejectedValueOnce(new Error('boom'));
    const quiet = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await start();
    await profile(20);
    await deliver(page(ids(0, 20)));
    await engine.settleAnalyses();
    quiet.mockRestore();
    expect(progress().pausedReason).toBe('error');
    expect(Object.keys(job().collected)).toHaveLength(20);
  });

  it('onglet fermé par l’utilisateur : gardé comme incomplet', async () => {
    await start();
    await deliver(page(ids(0, 20), 'c1'));
    fake.tabs.delete(tabId);
    await engine.handleTabRemoved(tabId);
    expect(hooks.onInterrupted).toHaveBeenCalledTimes(1);
    expect(fake.store.has(keys.scanJob(ID))).toBe(false);
  });

  it('limite d’abonnés dépassée : scan arrêté sans rien garder', async () => {
    await start();
    await profile(25_000);
    expect(hooks.onFollowerLimit).toHaveBeenCalledWith(expect.anything(), 25_000);
    expect(fake.store.has(keys.scanJob(ID))).toBe(false);
    expect(fake.tabs.has(tabId)).toBe(false);
  });
});

describe('contrôle léger', () => {
  it('s’arrête dès la première page et le total', async () => {
    await start('quick');
    await profile(200);
    await deliver(page(ids(0, 50), 'c1'));
    await engine.settleAnalyses();
    expect(hooks.onComplete).toHaveBeenCalledTimes(1);
    expect(hooks.onComplete.mock.calls[0]![0].top).toHaveLength(50);
  });

  it('alarme de délai perdue : le chien de garde abandonne le contrôle', async () => {
    await start('quick');
    vi.useFakeTimers({ now: Date.now() + 6 * 60_000, toFake: ['Date'] });
    expect(await engine.giveUpIfStalled(ID)).toBe(true);
    vi.useRealTimers();
    expect(fake.store.has(keys.scanJob(ID))).toBe(false);
    expect(fake.tabs.has(tabId)).toBe(false);
  });

  it('abandon par le délai : renvoie vrai une seule fois', async () => {
    await start('quick');
    expect(await engine.abortQuick(ID)).toBe(true);
    expect(await engine.abortQuick(ID)).toBe(false);
  });
});

describe('reprise', () => {
  it('pause de plusieurs jours : scan écarté, rien de gardé pour le reprendre', async () => {
    await start();
    await deliver(page(ids(0, 20), 'c1'));
    await deliver('', 'c1', { status: 429 });
    vi.useFakeTimers({ now: Date.now() + 3 * 86_400_000, toFake: ['Date'] });
    expect(await engine.resumeScan(ID)).toBe(false);
    vi.useRealTimers();
    expect(hooks.onInterrupted).not.toHaveBeenCalled();
    expect(fake.store.has(keys.scanJob(ID))).toBe(false);
    expect(fake.tabs.has(tabId)).toBe(false);
  });

  it('scan en cours abandonné depuis plusieurs jours (Chrome fermé) : écarté aussi', async () => {
    await start();
    vi.useFakeTimers({ now: Date.now() + 3 * 86_400_000, toFake: ['Date'] });
    expect(await engine.resumeScan(ID)).toBe(false);
    vi.useRealTimers();
    expect(fake.store.has(keys.scanJob(ID))).toBe(false);
  });

  it('reprise : une page vide ne vaut pas fin de liste, même près du total grâce aux abonnés repris', async () => {
    await chrome.storage.local.set({
      [keys.partialScan(ID)]: { kind: 'check', at: Date.now(), expectedTotal: 200, collected: Object.fromEntries(ids(0, 199).map((id) => [id, { handle: `u${id}`, name: id, following: false }])) },
    });
    await start();
    await profile(200);
    await deliver(page([]));
    await engine.settleAnalyses();
    expect(hooks.onComplete).not.toHaveBeenCalled();
  });

  it('onglet occupé : pas rechargé', async () => {
    await start();
    const reload = vi.spyOn(chrome.tabs, 'reload');
    vi.spyOn(chrome.tabs, 'sendMessage').mockReturnValue(new Promise<never>(() => undefined) as never);
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    const loaded = engine.handleTabLoaded(tabId, 'https://x.com/moi/followers');
    await vi.advanceTimersByTimeAsync(4000);
    await loaded;
    vi.useRealTimers();
    expect(reload).not.toHaveBeenCalled();
  });

  it('script de page absent sur la même page : rechargé', async () => {
    await start();
    const reload = vi.spyOn(chrome.tabs, 'reload');
    vi.spyOn(chrome.tabs, 'sendMessage').mockRejectedValue(new Error('no-receiver'));
    await engine.handleTabLoaded(tabId, 'https://x.com/moi/followers');
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('voile', () => {
  it('reçoit ses textes déjà traduits, avec le compte à rebours à remplir', async () => {
    await start();
    await deliver(page(ids(0, 20), 'c1'));
    const update = fake.commands.map((c) => c.message as { xgCmd: string; texts?: { count: string; resume: string; countdown: { seconds: string } } }).findLast((m) => m.xgCmd === 'progress');
    expect(update?.texts?.count).toBe('20');
    expect(update?.texts?.resume).toContain('{{countdown}}');
    expect(update?.texts?.countdown.seconds).toContain('{{s}}');
  });
});

describe('reprise après arrêt du service worker', () => {
  it('pages perdues entre deux écritures : `gap` posé', async () => {
    await start();
    await deliver(page(ids(0, 20), 'c1'));
    // Le service worker redémarre : la liste écrite ne contient pas la dernière page.
    vi.resetModules();
    engine = await import('./scan-engine');
    engine.setScanHooks(hooks as never);
    await engine.interruptScan(ID);
    expect(hooks.onInterrupted.mock.calls[0]![0].gap).toBe(true);
  });
});
