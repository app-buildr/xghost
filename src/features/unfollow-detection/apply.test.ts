import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { keys } from '@/shared/storage/keys';
import type { FollowCheckReading, FollowCheckResult, ScanJob, Snapshot, TrackedAccount } from '@/shared/types';
import { installFakeChrome, type FakeChrome } from '@/test/fake-chrome';
import { decodeEvent, encodeEvent } from '@/domain/events/codec';
import { loadEvents, updateEvents } from '@/features/events/repository';
import { markFalseDeparture, restoreFalseDeparture } from '@/features/events/commands';
import { applyFollowChecks, applyQuickCheck, applyScan, auditDepartures, saveIncomplete } from './apply';
import { enqueueFollowChecks, loadFollowChecks, loadProfiles, nextFollowCheck } from '@/features/followers-sync/repository';

const ID = '42';
const HOUR = 3_600_000;
const BASE = Date.UTC(2026, 0, 1);

const id = (i: number) => String(1_000_000_000_000 + i);
const list = (n: number, from = 0) => Array.from({ length: n }, (_, i) => id(from + i));
const profile = (i: string) => ({ handle: `u${i.slice(-8)}`, name: `Nom ${i}`, following: false });
const collected = (ids: readonly string[]) => Object.fromEntries(ids.map((i) => [i, profile(i)]));

let fake: FakeChrome;

async function seed({
  account = {},
  snapshot,
  events = [],
}: {
  account?: Partial<TrackedAccount>;
  snapshot?: Partial<Snapshot> & { ids: string[] };
  events?: Parameters<typeof encodeEvent>[0][];
}) {
  const stored: TrackedAccount = { id: ID, handle: 'moi', addedAt: BASE, mutualsOnly: false, baselineAt: BASE, lastScanAt: BASE, ...account };
  await chrome.storage.local.set({
    [keys.accounts]: { [ID]: stored },
    ...(snapshot
      ? {
          [keys.snapshot(ID)]: {
            at: BASE,
            total: snapshot.ids.length,
            xTotal: snapshot.ids.length,
            top: snapshot.ids.slice(0, 200),
            ordered: true,
            ...snapshot,
          } satisfies Snapshot,
          [keys.profiles(ID)]: collected(snapshot.ids),
        }
      : {}),
    [keys.events(ID)]: events.map(encodeEvent),
  });
}

function job(ids: readonly string[], over: Partial<ScanJob> = {}): ScanJob {
  return {
    accountId: ID,
    kind: 'check',
    status: 'running',
    startedAt: BASE + HOUR,
    updatedAt: BASE + HOUR,
    pages: 1,
    collected: collected(ids),
    top: [...ids],
    count: ids.length,
    expectedTotal: ids.length,
    totalSeen: true,
    reachedEnd: true,
    ...over,
  };
}

/** Résultat de la vérification d'un départ en file, avec son contexte de mise en file. */
async function resultFor(profileId: string, reading: FollowCheckReading = {}): Promise<FollowCheckResult> {
  const q = (await loadFollowChecks(ID)).find((x) => x.profileId === profileId)!;
  return { eventId: q.eventId, profileId, detectedAt: q.detectedAt, notified: q.notified, recheck: q.recheck, audit: q.audit, ...reading };
}

const account = async () => (fake.store.get(keys.accounts) as Record<string, TrackedAccount>)[ID]!;
const snapshotIds = () => (fake.store.get(keys.snapshot(ID)) as Snapshot).ids;

beforeEach(() => {
  fake = installFakeChrome();
});

describe('applyScan', () => {
  it('référence : aucun événement, date posée', async () => {
    await seed({ account: { baselineAt: undefined, lastScanAt: undefined } });
    const out = await applyScan(job(list(5), { kind: 'baseline' }));
    expect(out.kind).toBe('baseline');
    expect(await loadEvents(ID)).toEqual([]);
    expect((await account()).baselineAt).toBeGreaterThan(0);
    expect(snapshotIds()).toEqual(list(5));
  });

  it('référence : une date existante (sauvegarde importée) est conservée', async () => {
    await seed({ account: { baselineAt: 123 } });
    await applyScan(job(list(5), { kind: 'baseline' }));
    expect((await account()).baselineAt).toBe(123);
  });

  it('scan incomplet : instantané inchangé, abonnés gardés, jamais comparé', async () => {
    await seed({ snapshot: { ids: list(100) } });
    const out = await applyScan(job(list(50), { expectedTotal: 100, reachedEnd: true }));
    expect(out.kind).toBe('incomplete');
    expect(snapshotIds()).toEqual(list(100));
    expect(await loadEvents(ID)).toEqual([]);
    expect(fake.store.has(keys.partialScan(ID))).toBe(true);
    expect((await account()).lastScan?.complete).toBe(false);
  });

  it('pages perdues (`gap`) : jamais complet, arrêt anticipé refusé', async () => {
    await seed({ snapshot: { ids: list(100) } });
    const out = await applyScan(job(list(100), { gap: true, earlyStop: { matchedIndex: 50 } }));
    expect(out.kind).toBe('incomplete');
  });

  it('scan comparé : départs datés de la première détection, arrivées du scan', async () => {
    await seed({ account: { pending: { count: 1, at: BASE + 5 * 60_000 } }, snapshot: { ids: list(10) } });
    const ids = [id(99), ...list(10).slice(1)];
    const out = await applyScan(job(ids));
    expect(out).toEqual({ kind: 'compared', departures: 1, arrivals: 1 });
    const events = await loadEvents(ID);
    expect(events.find((e) => e.type === 'departure')?.at).toBe(BASE + 5 * 60_000);
    expect((await account()).pending).toBeUndefined();
    // Notifié seulement après la vérification du profil.
    expect(fake.notifications).toHaveLength(0);
    expect((await loadFollowChecks(ID)).map((q) => q.profileId)).toEqual([id(0)]);
  });

  it('scan de bout en bout : le compteur des contrôles légers repart de zéro', async () => {
    await seed({ account: { quickSinceFull: 7 }, snapshot: { ids: list(10) } });
    await applyScan(job(list(10)));
    expect((await account()).quickSinceFull).toBe(0);
  });

  it('fin de liste non atteinte : la suite est reprise, le scan de contrôle reste dû', async () => {
    await seed({ account: { quickSinceFull: 7 }, snapshot: { ids: list(200) } });
    const out = await applyScan(job(list(199), { reachedEnd: false, expectedTotal: 200 }));
    expect(out).toEqual({ kind: 'compared', departures: 0, arrivals: 0 });
    expect(snapshotIds()).toHaveLength(200);
    expect((await account()).quickSinceFull).toBe(7);
  });

  it('résultat suspect : nouvel essai, instantané intact', async () => {
    await seed({ snapshot: { ids: list(100) } });
    const out = await applyScan(job(list(60), { expectedTotal: 60 }));
    expect(out.kind).toBe('retry');
    expect(snapshotIds()).toHaveLength(100);
    expect(fake.store.get(keys.suspicious(ID))).toBe(1);
  });

  it('scan rejoué (service worker arrêté) : aucun doublon', async () => {
    await seed({ snapshot: { ids: list(10) } });
    const scan = job(list(9));
    await applyScan(scan);
    // Instantané remis à son état précédent : arrêt entre l'historique et l'instantané.
    await chrome.storage.local.set({ [keys.snapshot(ID)]: { at: BASE, ids: list(10), total: 10, ordered: true } });
    await applyScan(scan);
    expect((await loadEvents(ID)).filter((e) => e.type === 'departure')).toHaveLength(1);
  });

  it('compte ignoré : enregistré déjà vu, sans notification', async () => {
    await seed({ snapshot: { ids: list(10) } });
    await chrome.storage.local.set({ [keys.ignored(ID)]: [id(9)] });
    await applyScan(job(list(9)));
    const [event] = await loadEvents(ID);
    expect(event?.seen).toBe(true);
    expect(fake.notifications).toHaveLength(0);
  });
});

describe('saveIncomplete', () => {
  it('garde les abonnés pour la reprise et marque le scan incomplet', async () => {
    await seed({ snapshot: { ids: list(10) } });
    const coverage = await saveIncomplete(job(list(5), { expectedTotal: 10 }));
    expect(coverage.complete).toBe(false);
    expect(fake.store.has(keys.partialScan(ID))).toBe(true);
  });
});

describe('applyQuickCheck', () => {
  const quick = (ids: readonly string[], over: Partial<ScanJob> = {}) => job(ids, { kind: 'quick', ...over });

  it('total stable, aucun nouveau : rien à signaler', async () => {
    await seed({ snapshot: { ids: list(100) } });
    const out = await applyQuickCheck(quick(list(50), { expectedTotal: 100 }));
    expect(out).toEqual({ kind: 'clear', arrivals: 0 });
    expect(await loadEvents(ID)).toEqual([]);
  });

  it('nouvel abonné en tête : arrivée enregistrée, liste à jour', async () => {
    await seed({ snapshot: { ids: list(100) } });
    const out = await applyQuickCheck(quick([id(999), ...list(49)], { expectedTotal: 101 }));
    expect(out).toEqual({ kind: 'clear', arrivals: 1 });
    expect(snapshotIds()[0]).toBe(id(999));
  });

  it('total en baisse sans explication : écart en attente', async () => {
    await seed({ snapshot: { ids: list(100) } });
    const out = await applyQuickCheck(quick(list(50), { expectedTotal: 98 }));
    expect(out).toEqual({ kind: 'pending', missing: 2, full: false });
    expect((await account()).pending?.count).toBe(2);
  });

  it('contrôle rejoué : écart et compteurs ne sont pas recomptés', async () => {
    await seed({ snapshot: { ids: list(100) } });
    const check = quick(list(50), { expectedTotal: 98 });
    await applyQuickCheck(check);
    await applyQuickCheck(check);
    const a = await account();
    expect(a.pending?.count).toBe(2);
    expect(a.quickSinceFull).toBe(1);
  });

  it('total X en retard : revérification, pas de scan complet', async () => {
    await seed({ snapshot: { ids: list(100) } });
    const out = await applyQuickCheck(quick([id(999), ...list(49)], { expectedTotal: 100 }));
    expect(out.kind).toBe('recheck');
    expect((await account()).lastQuick?.staleRuns).toBe(1);
  });

  it('aucun changement : profils et instantané ne sont pas réécrits', async () => {
    await seed({ snapshot: { ids: list(100) } });
    const before = { snapshot: fake.store.get(keys.snapshot(ID)), profiles: fake.store.get(keys.profiles(ID)) };
    fake.store.set(keys.profiles(ID), before.profiles);
    let writes = 0;
    chrome.storage.onChanged.addListener((changes) => {
      if (keys.profiles(ID) in changes || keys.snapshot(ID) in changes) writes++;
    });
    await applyQuickCheck(quick(list(50), { expectedTotal: 100 }));
    expect(writes).toBe(0);
  });

  it('sans instantané : ignoré', async () => {
    await seed({});
    expect(await applyQuickCheck(quick(list(5)))).toEqual({ kind: 'skipped' });
  });
});

describe('contrôle par le total X', () => {
  it('écart en attente : les départs annoncés sont expliqués', async () => {
    // Le contrôle léger a déjà ramené le total de l'instantané à 90.
    await seed({ account: { pending: { count: 10, at: BASE } }, snapshot: { ids: list(100), xTotal: 90 } });
    const out = await applyScan(job(list(90), { expectedTotal: 90 }));
    expect(out).toEqual({ kind: 'compared', departures: 10, arrivals: 0 });
  });

  it('total stable mais abonnés manquants : rien n’est comparé, nouvel essai', async () => {
    await seed({ snapshot: { ids: list(1000) } });
    const out = await applyScan(job(list(991), { expectedTotal: 1000 }));
    expect(out.kind).toBe('retry');
    expect(snapshotIds()).toHaveLength(1000);
    expect(await loadEvents(ID)).toEqual([]);
  });

  it('même résultat relu en entier plusieurs fois : accepté, la détection ne reste pas figée', async () => {
    await seed({ snapshot: { ids: list(1000) } });
    await chrome.storage.local.set({ [keys.suspicious(ID)]: 2 });
    const out = await applyScan(job(list(991), { expectedTotal: 1000 }));
    expect(out).toEqual({ kind: 'compared', departures: 9, arrivals: 0 });
  });

  it('jamais accepté sur une reprise : il faut une liste relue en entier', async () => {
    await seed({ snapshot: { ids: list(1000) } });
    await chrome.storage.local.set({ [keys.suspicious(ID)]: 2 });
    const out = await applyScan(job(list(991), { expectedTotal: 1000, seeded: 500 }));
    expect(out.kind).toBe('retry');
    expect(snapshotIds()).toHaveLength(1000);
  });

  it('total en baisse : la variation est acceptée', async () => {
    await seed({ snapshot: { ids: list(1000) } });
    const out = await applyScan(job(list(980), { expectedTotal: 980 }));
    expect(out).toEqual({ kind: 'compared', departures: 20, arrivals: 0 });
  });

  it('variation suspecte confirmée par le total : acceptée au troisième essai', async () => {
    await seed({ snapshot: { ids: list(100) } });
    await chrome.storage.local.set({ [keys.suspicious(ID)]: 2 });
    const out = await applyScan(job(list(60), { expectedTotal: 60 }));
    expect(out.kind).toBe('compared');
    expect(fake.store.has(keys.suspicious(ID))).toBe(false);
  });

  it('liste relue depuis le haut : marquée hors de l’ordre de x.com', async () => {
    await seed({ snapshot: { ids: list(10) } });
    await applyScan(job(list(10), { unordered: true }));
    expect((fake.store.get(keys.snapshot(ID)) as Snapshot).ordered).toBe(false);
  });

  it('trop d’entrées illisibles : scan incomplet', async () => {
    await seed({ snapshot: { ids: list(100) } });
    const out = await applyScan(job(list(100), { skipped: 6 }));
    expect(out.kind).toBe('incomplete');
  });
});

describe('corrections après review', () => {
  it('fin de liste non lue sans ancienne liste ordonnée : incomplet', async () => {
    await seed({ snapshot: { ids: list(1000), ordered: false } });
    const out = await applyScan(job(list(995), { reachedEnd: false, expectedTotal: 1000 }));
    expect(out.kind).toBe('incomplete');
    expect(await loadEvents(ID)).toEqual([]);
  });

  it('scan incomplet : le partiel garde la date de lecture, pas celle de la sauvegarde', async () => {
    await seed({ snapshot: { ids: list(10) } });
    await saveIncomplete(job(list(5), { expectedTotal: 10, startedAt: 111 }));
    expect((fake.store.get(keys.partialScan(ID)) as { at: number }).at).toBe(111);
    await saveIncomplete(job(list(5), { expectedTotal: 10, startedAt: 500, seededAt: 222 }));
    expect((fake.store.get(keys.partialScan(ID)) as { at: number }).at).toBe(222);
  });

  it('reprise : le scan de contrôle reste dû', async () => {
    await seed({ account: { quickSinceFull: 7 }, snapshot: { ids: list(10) } });
    await applyScan(job(list(10), { seeded: 5 }));
    expect((await account()).quickSinceFull).toBe(7);
  });


  it('arrêt anticipé avec des entrées illisibles : pas de complet forcé', async () => {
    await seed({ snapshot: { ids: list(200) } });
    const out = await applyScan(job(list(60), { earlyStop: { matchedIndex: 59 }, reachedEnd: false, skipped: 6, expectedTotal: 200 }));
    expect(out.kind).toBe('incomplete');
  });

  it('total inconnu, fin de liste lue : les départs sont comptés', async () => {
    await seed({ snapshot: { ids: list(20) } });
    const out = await applyScan(job(list(19), { expectedTotal: 0, totalSeen: false }));
    expect(out).toEqual({ kind: 'compared', departures: 1, arrivals: 0 });
  });

  it('scan complet réussi : le bandeau des contrôles échoués disparaît', async () => {
    await seed({ account: { quickFailures: 3 }, snapshot: { ids: list(10) } });
    await applyScan(job(list(10)));
    expect((await account()).quickFailures).toBeUndefined();
  });

  it('départ supprimé par l’utilisateur : pas recréé par la réparation', async () => {
    const arrival = decodeEvent([1, id(50), 'parti', Math.floor(BASE / 1000) - 100, 0, 0, 1]);
    await seed({ snapshot: { ids: list(10) }, events: [arrival] });
    const removed = decodeEvent([0, id(50), 'parti', Math.floor(BASE / 1000) - 50, 0, 0, 1]);
    await chrome.storage.local.set({ [keys.repaired(ID)]: [encodeEvent(removed)] });
    await applyScan(job(list(10)));
    expect((await loadEvents(ID)).filter((e) => e.type === 'departure')).toEqual([]);
  });

  it('sans faux départs : l’historique n’est pas réécrit par le nettoyage', async () => {
    await seed({ snapshot: { ids: list(10) } });
    let writes = 0;
    chrome.storage.onChanged.addListener((changes) => {
      if (keys.events(ID) in changes) writes++;
    });
    await applyScan(job(list(10)));
    expect(writes).toBe(0);
  });
});

describe('faux départs', () => {
  /** Ancienne liste de 2 000 ; l'abonné en position `at` remonte en tête. */
  const returned = (at: number) => [id(at), ...list(2000).filter((i) => i !== id(at))];

  it('arrêt anticipé : un abonné revenu ne déclare pas parti tout ce qui le précède', async () => {
    await seed({ snapshot: { ids: list(2000) } });
    const read = returned(300).slice(0, 60);
    const out = await applyScan(job(read, { target: 1, earlyStop: { matchedIndex: 300 }, reachedEnd: false, expectedTotal: 2000 }));
    expect(out.kind).toBe('retry');
    expect(await loadEvents(ID)).toEqual([]);
  });

  it('reprise sans nouvel abonné : une liste à 85 % ne crée pas de faux départs', async () => {
    await seed({ snapshot: { ids: list(2000) } });
    await applyScan(job(list(1700), { expectedTotal: 2000, seeded: 1700, top: [], reachedEnd: true }));
    expect(await loadEvents(ID)).toEqual([]);
  });

  it('liste tronquée répétée : jamais acceptée tant que le total X ne baisse pas', async () => {
    await seed({ snapshot: { ids: list(2000) } });
    await chrome.storage.local.set({ [keys.suspicious(ID)]: 2 });
    await applyScan(job(list(20), { expectedTotal: 2000, seeded: 20, reachedEnd: true }));
    expect(snapshotIds()).toHaveLength(2000);
  });

  it('contrôle léger : un abonné revenu ne fait pas partir le dernier de la fenêtre', async () => {
    await seed({ snapshot: { ids: list(2000) } });
    const page = [id(500), ...list(49)];
    await applyQuickCheck(job(page, { kind: 'quick', expectedTotal: 2000 }));
    expect(await loadEvents(ID)).toEqual([]);
  });
});

describe('vérification du follow back des départs', () => {
  it('chaque départ détecté est mis en file, sauf les comptes ignorés', async () => {
    await seed({ snapshot: { ids: list(10) } });
    await chrome.storage.local.set({ [keys.ignored(ID)]: [id(8)] });
    await applyScan(job(list(8)));
    const queue = await loadFollowChecks(ID);
    expect(queue.map((q) => q.profileId)).toEqual([id(9)]);
    const [departure] = (await loadEvents(ID)).filter((e) => e.profileId === id(9));
    expect(queue[0]).toMatchObject({ eventId: departure!.id, handle: profile(id(9)).handle });
  });

  it('le follow back lu sur le profil remplace la valeur du cache', async () => {
    await seed({ snapshot: { ids: list(10) } });
    await applyScan(job(list(9)));
    const [departure] = await loadEvents(ID);
    expect(departure?.mutual).toBe(false);
    await applyFollowChecks(ID, [
      { eventId: departure!.id, profileId: id(9), following: true, profile: { handle: 'nouveau', name: 'N', following: true } },
    ]);
    expect((await loadEvents(ID))[0]?.mutual).toBe(true);
    expect((await loadProfiles(ID))[id(9)]).toMatchObject({ handle: 'nouveau', following: true });
  });

  it('réponse sans l’info : le départ garde sa valeur', async () => {
    await seed({ snapshot: { ids: list(10) } });
    await applyScan(job(list(9)));
    const [departure] = await loadEvents(ID);
    await applyFollowChecks(ID, [{ eventId: departure!.id, profileId: id(9) }]);
    expect((await loadEvents(ID))[0]?.mutual).toBe(false);
  });

  it('« Uniquement les follow back » : un départ qui s’avère suivi est notifié à ce moment-là', async () => {
    await seed({ account: { mutualsOnly: true }, snapshot: { ids: list(10) } });
    await applyScan(job(list(9)));
    expect(fake.notifications).toHaveLength(0);
    await applyFollowChecks(ID, [await resultFor(id(9), { following: true })]);
    expect(fake.notifications).toHaveLength(1);
  });

  it('« Uniquement les follow back » : un départ vérifié plus de 24 h après est mis à jour sans notification', async () => {
    await seed({ account: { mutualsOnly: true }, snapshot: { ids: list(10) } });
    await applyScan(job(list(9)));
    await updateEvents(ID, (events) => events.map((e) => ({ ...e, at: Date.now() - 25 * HOUR })));
    const [departure] = await loadEvents(ID);
    await applyFollowChecks(ID, [{ eventId: departure!.id, profileId: id(9), following: true }]);
    expect((await loadEvents(ID))[0]?.mutual).toBe(true);
    expect(fake.notifications).toHaveLength(0);
  });

  it('notification après la vérification du profil : départ confirmé', async () => {
    await seed({ snapshot: { ids: list(10) } });
    await applyScan(job(list(9)));
    expect(fake.notifications).toHaveLength(0);
    const [departure] = await loadEvents(ID);
    await applyFollowChecks(ID, [await resultFor(id(9), { following: false, followedBy: false })]);
    expect((await loadEvents(ID)).map((e) => e.id)).toEqual([departure!.id]);
    expect(fake.notifications).toHaveLength(1);
  });

  it('détecté depuis plus de 24 h (même daté plus tôt) : pas de notification ; daté plus tôt mais détecté maintenant : notifié', async () => {
    // Départ daté de la première détection du contrôle léger, il y a deux jours : notifié quand même.
    await seed({ account: { pending: { count: 1, at: Date.now() - 48 * HOUR } }, snapshot: { ids: list(10) } });
    await applyScan(job(list(9)));
    await applyFollowChecks(ID, [await resultFor(id(9), { followedBy: false })]);
    expect(fake.notifications).toHaveLength(1);
    // Vérifié plus de 24 h après sa mise en file : rien.
    await seed({ snapshot: { ids: list(10) } });
    await applyScan(job(list(9)));
    const late = { ...(await resultFor(id(9), { followedBy: false })), detectedAt: Date.now() - 25 * HOUR };
    await applyFollowChecks(ID, [late]);
    expect(fake.notifications).toHaveLength(1);
  });

  it('file d’une version précédente (départ déjà notifié à sa détection) : pas de seconde notification', async () => {
    await seed({ snapshot: { ids: list(10) } });
    await applyScan(job(list(9)));
    const [departure] = await loadEvents(ID);
    await applyFollowChecks(ID, [{ eventId: departure!.id, profileId: id(9), followedBy: false }]);
    expect(fake.notifications).toHaveLength(0);
  });

  it('revenu avant la vérification : pas de notification', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      await seed({ snapshot: { ids: list(10) } });
      vi.setSystemTime(BASE + HOUR);
      await applyScan(job(list(9)));
      const result = await resultFor(id(9), { followedBy: true });
      vi.setSystemTime(BASE + 2 * HOUR);
      await applyScan(job(list(10)));
      await applyFollowChecks(ID, [result]);
      expect((await loadEvents(ID)).map((e) => e.type).sort()).toEqual(['arrival', 'departure']);
      expect(fake.notifications).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('grosse vague de départs : notifiée tout de suite, groupée, sans seconde notification après vérification', async () => {
    await seed({ snapshot: { ids: list(100) } });
    await applyScan(job(list(80), { expectedTotal: 80 }));
    expect(fake.notifications).toHaveLength(1);
    const queue = await loadFollowChecks(ID);
    expect(queue).toHaveLength(20);
    expect(queue.every((q) => q.notified)).toBe(true);
    await applyFollowChecks(ID, await Promise.all(queue.map((q) => resultFor(q.profileId, { followedBy: false }))));
    expect(fake.notifications).toHaveLength(1);
  });

  it('profil sans réponse après plusieurs essais (ou compte suspendu) : départ notifié tel quel', async () => {
    await seed({ snapshot: { ids: list(10) } });
    await applyScan(job(list(9)));
    await applyFollowChecks(ID, [await resultFor(id(9))]);
    expect(await loadEvents(ID)).toHaveLength(1);
    expect(fake.notifications).toHaveLength(1);
  });

  describe('abonné caché par X (le profil dit qu’il me suit toujours)', () => {
    const hidden = id(200);
    const rest = list(200);
    const at = (h: number) => vi.setSystemTime(BASE + h * HOUR);
    const types = async () => (await loadEvents(ID)).map((e) => e.type);
    const hiddenIds = () => fake.store.get(keys.hidden(ID)) as string[] | undefined;

    /** Scan où X cache `hidden` (total inchangé), puis vérification de son profil. */
    async function hideAndCheck(h: number) {
      at(h);
      await applyScan(job(rest, { expectedTotal: 201 }));
      expect((await loadEvents(ID)).some((e) => e.type === 'departure' && e.profileId === hidden)).toBe(true);
      await applyFollowChecks(ID, [await resultFor(hidden, { following: false, followedBy: true })]);
      // La passe retire de la file les réponses appliquées.
      await chrome.storage.local.remove(keys.followChecks(ID));
    }

    beforeEach(() => {
      vi.useFakeTimers({ toFake: ['Date'] });
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('faux départ retiré sans notification, ni recréé, ni compté comme une arrivée à son retour', async () => {
      await seed({ snapshot: { ids: rest } });
      at(1);
      await applyScan(job([hidden, ...rest]));
      await hideAndCheck(2);
      expect(await types()).toEqual(['arrival']);
      expect(hiddenIds()).toEqual([hidden]);
      expect(fake.notifications).toHaveLength(0);

      // Toujours caché : la réparation de l'historique ne recrée pas le départ.
      at(3);
      await applyScan(job(rest, { expectedTotal: 201 }));
      expect(await types()).toEqual(['arrival']);
      // De retour dans la liste : pas de nouvelle arrivée, il n'est plus tenu pour caché.
      at(4);
      await applyScan(job([hidden, ...rest]));
      expect(await types()).toEqual(['arrival']);
      expect(hiddenIds()).toBeUndefined();
      expect(snapshotIds()).toContain(hidden);
    });

    it('abonné du scan de référence (aucun mouvement) : pas d’arrivée à son retour', async () => {
      await seed({ snapshot: { ids: [hidden, ...rest] } });
      await hideAndCheck(1);
      expect(await types()).toEqual([]);
      at(2);
      await applyScan(job([hidden, ...rest]));
      expect(await types()).toEqual([]);
    });

    it('caché puis réaffiché à plusieurs reprises : jamais notifié', async () => {
      await seed({ snapshot: { ids: [hidden, ...rest] } });
      await hideAndCheck(1);
      at(2);
      await applyScan(job([hidden, ...rest]));
      await hideAndCheck(3);
      expect(await types()).toEqual([]);
      expect(fake.notifications).toHaveLength(0);
    });

    it('contrôle léger : son retour en tête de liste n’est pas une arrivée', async () => {
      await seed({ snapshot: { ids: rest, xTotal: 201 } });
      await chrome.storage.local.set({ [keys.hidden(ID)]: [hidden] });
      at(1);
      const out = await applyQuickCheck(job([hidden, ...rest.slice(0, 49)], { kind: 'quick', expectedTotal: 201 }));
      expect(out).toEqual({ kind: 'clear', arrivals: 0 });
      expect(await types()).toEqual([]);
      expect(snapshotIds().slice(0, 2)).toEqual([hidden, rest[0]]);
      expect(hiddenIds()).toBeUndefined();
    });

    it('vérifié plus de 24 h après, ou revenu entre-temps : le départ reste', async () => {
      await seed({ snapshot: { ids: [hidden, ...rest] } });
      at(1);
      await applyScan(job(rest, { expectedTotal: 201 }));
      const result = await resultFor(hidden, { followedBy: true });
      at(26);
      await applyFollowChecks(ID, [result]);
      expect(await types()).toEqual(['departure']);
      expect(hiddenIds()).toBeUndefined();
    });

    it('« Faux départ » signalé à la main : retiré, tenu pour caché, pas d’arrivée à son retour ; annulable', async () => {
      await seed({ snapshot: { ids: [hidden, ...rest] } });
      at(1);
      await applyScan(job(rest, { expectedTotal: 201 }));
      const departure = (await loadEvents(ID)).find((e) => e.profileId === hidden)!;
      const removed = await markFalseDeparture(ID, departure.id);
      expect(removed?.id).toBe(departure.id);
      expect(await types()).toEqual([]);
      expect(hiddenIds()).toEqual([hidden]);

      // Annuler : le départ revient, le compte n'est plus tenu pour caché.
      await restoreFalseDeparture(ID, removed!);
      expect(await types()).toEqual(['departure']);
      expect(hiddenIds()).toBeUndefined();

      await markFalseDeparture(ID, departure.id);
      at(2);
      await applyScan(job([hidden, ...rest]));
      expect(await types()).toEqual([]);
      expect(hiddenIds()).toBeUndefined();
    });

    it('« Faux départ » sur une arrivée : sans effet', async () => {
      await seed({ snapshot: { ids: rest } });
      at(1);
      await applyScan(job([hidden, ...rest]));
      const arrival = (await loadEvents(ID))[0]!;
      expect(await markFalseDeparture(ID, arrival.id)).toBeUndefined();
      expect(await types()).toEqual(['arrival']);
    });

    it('ancien départ revérifié à la mise à jour : retiré s’il me suit toujours, sans notification', async () => {
      await seed({ snapshot: { ids: [hidden, ...rest] } });
      at(1);
      await applyScan(job(rest, { expectedTotal: 201 }));
      // Vérifié par une version qui ne lisait pas `followedBy` : la file est vidée, le départ reste.
      await chrome.storage.local.remove(keys.followChecks(ID));
      at(48);
      expect(await auditDepartures(ID)).toBe(1);
      const queue = await loadFollowChecks(ID);
      expect(queue.map((q) => [q.profileId, q.audit, q.notified])).toEqual([[hidden, true, true]]);
      await applyFollowChecks(ID, [await resultFor(hidden, { following: false, followedBy: true })]);
      expect(await types()).toEqual([]);
      expect(hiddenIds()).toEqual([hidden]);
      expect(fake.notifications).toHaveLength(0);
    });

    it('revérification limitée aux départs des 30 derniers jours', async () => {
      await seed({ snapshot: { ids: [hidden, ...rest] } });
      at(1);
      await applyScan(job(rest, { expectedTotal: 201 }));
      await chrome.storage.local.remove(keys.followChecks(ID));
      at(31 * 24 + 2);
      expect(await auditDepartures(ID)).toBe(0);
      expect(await loadFollowChecks(ID)).toEqual([]);
    });

    it('« Faux départ » sur un départ suivi d’un retour : sans effet', async () => {
      await seed({ snapshot: { ids: [hidden, ...rest] } });
      at(1);
      await applyScan(job(rest, { expectedTotal: 201 }));
      const departure = (await loadEvents(ID)).find((e) => e.type === 'departure')!;
      at(2);
      await applyScan(job([hidden, ...rest]));
      expect(await markFalseDeparture(ID, departure.id)).toBeUndefined();
      expect((await types()).sort()).toEqual(['arrival', 'departure']);
      expect(hiddenIds()).toBeUndefined();
    });

    it('annulation d’un « Faux départ » illisible : le compte reste caché', async () => {
      await seed({ snapshot: { ids: [hidden, ...rest] } });
      at(1);
      await applyScan(job(rest, { expectedTotal: 201 }));
      const departure = (await loadEvents(ID)).find((e) => e.type === 'departure')!;
      await markFalseDeparture(ID, departure.id);
      await restoreFalseDeparture(ID, { ...departure, profileId: 'pas-un-id' } as never);
      expect(hiddenIds()).toEqual([hidden]);
    });

    it('départ déjà en file depuis plus de 24 h : revérifié par la mise à jour, faux départ retiré', async () => {
      await seed({ snapshot: { ids: [hidden, ...rest] } });
      at(1);
      await applyScan(job(rest, { expectedTotal: 201 }));
      at(30);
      await auditDepartures(ID);
      const queue = await loadFollowChecks(ID);
      expect(queue).toHaveLength(1);
      expect(queue[0]!.audit).toBe(true);
      await applyFollowChecks(ID, [await resultFor(hidden, { followedBy: true })]);
      expect(await types()).toEqual([]);
      expect(hiddenIds()).toEqual([hidden]);
    });

    it('départ en file depuis moins de 24 h : garde sa vérification normale', async () => {
      await seed({ snapshot: { ids: [hidden, ...rest] } });
      at(1);
      await applyScan(job(rest, { expectedTotal: 201 }));
      at(2);
      await auditDepartures(ID);
      const queue = await loadFollowChecks(ID);
      expect(queue.map((q) => q.audit)).toEqual([undefined]);
    });

    it('« Faux départ » : la vérification en file devient une revérification ; s’il est parti, départ enregistré et notifié', async () => {
      await seed({ snapshot: { ids: [hidden, ...rest] } });
      at(1);
      await applyScan(job(rest, { expectedTotal: 201 }));
      const departure = (await loadEvents(ID)).find((e) => e.type === 'departure')!;
      await markFalseDeparture(ID, departure.id);
      const queue = await loadFollowChecks(ID);
      expect(queue.map((q) => [q.eventId, q.recheck])).toEqual([[`h:${hidden}`, true]]);
      at(2);
      await applyFollowChecks(ID, [await resultFor(hidden, { following: false, followedBy: false })]);
      expect(await types()).toEqual(['departure']);
      expect(hiddenIds()).toBeUndefined();
      expect(fake.notifications).toHaveLength(1);
    });

    it('« Faux départ » annulé : la revérification est retirée de la file', async () => {
      await seed({ snapshot: { ids: [hidden, ...rest] } });
      at(1);
      await applyScan(job(rest, { expectedTotal: 201 }));
      const departure = (await loadEvents(ID)).find((e) => e.type === 'departure')!;
      const removed = await markFalseDeparture(ID, departure.id);
      await restoreFalseDeparture(ID, removed!);
      expect(await loadFollowChecks(ID)).toEqual([]);
    });

    it('abonné caché devenu suspendu ou supprimé : départ enregistré sans notification, plus caché', async () => {
      await seed({ snapshot: { ids: [hidden, ...rest] } });
      await hideAndCheck(1);
      at(2);
      await applyScan(job(rest, { expectedTotal: 200 }));
      await applyFollowChecks(ID, [await resultFor(hidden, { unavailable: true })]);
      expect(await types()).toEqual(['departure']);
      expect(hiddenIds()).toBeUndefined();
      expect(fake.notifications).toHaveLength(0);
    });

    it('revérification d’un compte qui n’est plus caché : ignorée', async () => {
      await seed({ snapshot: { ids: [hidden, ...rest] } });
      await applyFollowChecks(ID, [{ eventId: `h:${hidden}`, profileId: hidden, recheck: true, followedBy: false }]);
      expect(await types()).toEqual([]);
      expect(fake.notifications).toHaveLength(0);
    });

    it('ancien départ revérifié qui ne me suit plus : le départ reste, sans nouvelle notification', async () => {
      await seed({ snapshot: { ids: [hidden, ...rest] } });
      at(1);
      await applyScan(job(rest, { expectedTotal: 201 }));
      await chrome.storage.local.remove(keys.followChecks(ID));
      at(48);
      await auditDepartures(ID);
      await applyFollowChecks(ID, [await resultFor(hidden, { following: false, followedBy: false })]);
      expect(await types()).toEqual(['departure']);
      expect(hiddenIds()).toBeUndefined();
      expect(fake.notifications).toHaveLength(0);
    });

    it('revérifié après chaque scan complet ; s’il ne me suit plus, vrai départ enregistré et notifié', async () => {
      await seed({ snapshot: { ids: [hidden, ...rest] } });
      await hideAndCheck(1);
      at(2);
      await applyScan(job(rest, { expectedTotal: 200 }));
      const queue = await loadFollowChecks(ID);
      expect(queue.map((q) => [q.eventId, q.recheck])).toEqual([[`h:${hidden}`, true]]);
      // Toujours abonné : rien ne change.
      await applyFollowChecks(ID, [await resultFor(hidden, { followedBy: true })]);
      expect(await types()).toEqual([]);
      expect(hiddenIds()).toEqual([hidden]);
      // Ne suit plus : départ.
      await applyFollowChecks(ID, [await resultFor(hidden, { followedBy: false })]);
      expect(await types()).toEqual(['departure']);
      expect(hiddenIds()).toBeUndefined();
      expect(fake.notifications).toHaveLength(1);
    });
  });
});

describe('file des vérifications', () => {
  const check = (i: number, audit = false) => ({ eventId: `e${i}`, profileId: id(i), handle: `u${i}`, ...(audit ? { audit } : {}) });

  it('les départs à vérifier passent avant les revérifications de la mise à jour', () => {
    const queue = [check(1, true), check(2, true), check(3)];
    expect(nextFollowCheck(queue)?.eventId).toBe('e3');
    expect(nextFollowCheck(queue, new Set(['e3']))?.eventId).toBe('e1');
    expect(nextFollowCheck([{ ...check(4), result: {} }])).toBeUndefined();
  });

  it('file pleine : les revérifications partent avant les départs', async () => {
    await enqueueFollowChecks(ID, [check(0)]);
    await enqueueFollowChecks(ID, list(499).map((_, i) => check(i + 1, true)));
    await enqueueFollowChecks(ID, [check(1000), check(1001)]);
    const queue = await loadFollowChecks(ID);
    expect(queue).toHaveLength(500);
    expect(queue[0]!.eventId).toBe('e0');
    expect(queue.slice(-2).map((q) => q.eventId)).toEqual(['e1000', 'e1001']);
    // Les revérifications mises en file en dernier (départs les plus anciens) sont parties.
    expect(queue.some((q) => q.eventId === 'e1')).toBe(true);
    expect(queue.some((q) => q.eventId === 'e499')).toBe(false);
  });
});
