import { loadAccounts, loadIgnored, patchAccount } from '@/features/accounts/repository';
import { notifyDepartures } from '@/features/alerts/notifications';
import { eventId } from '@/features/events/codec';
import { loadEvents, updateEvents } from '@/features/events/repository';
import { isVisible, missingMovements, newMovements } from '@/features/events/selectors';
import {
  recordTotal,
  clearPartial,
  loadProfiles,
  loadSnapshot,
  savePartial,
  saveProfiles,
  saveSnapshot,
  type ProfileCache,
} from '@/features/followers-sync/repository';
import { localKv } from '@/shared/storage/kv';
import { keys } from '@/shared/storage/keys';
import type { FollowEvent, ScanCoverage, ScanJob, TrackedAccount } from '@/shared/types';
import {
  assembleOrder,
  assessQuick,
  assessScan,
  diffFollowers,
  fillUnreadTail,
  isComplete,
  SUSPICIOUS_MAX_RETRIES,
} from './diff';
import { MINUTE } from '@/shared/utils/time';

/**
 * Exploitation des scans (§ 4.1, 4.2, 4.7) : référence, comparaison, garde-fous,
 * événements, instantané et notifications.
 * Le statut des comptes partis n'est pas vérifié : xGhost n'ouvre jamais leur profil.
 */

const SUSPICIOUS_RETRY_MS = 30 * MINUTE;
/** Haut de la liste gardé dans l'ordre de x.com, pour le contrôle léger. */
const SNAPSHOT_TOP_SIZE = 200;
/** Nombre de contrôles « total X en retard » tolérés avant de lancer un scan complet. */
const MAX_STALE_RUNS = 3;
const STALE_RECHECK_MS = 10 * MINUTE;

export type ApplyOutcome =
  | { kind: 'incomplete'; coverage: ScanCoverage }
  | { kind: 'baseline' }
  | { kind: 'compared'; departures: number; arrivals: number }
  | { kind: 'retry'; reason: 'suspicious'; at: number };

export type QuickOutcome =
  | { kind: 'skipped' }
  | { kind: 'clear'; arrivals: number }
  | { kind: 'recheck'; at: number }
  | { kind: 'pending'; missing: number; full: boolean };

// ---------------------------------------------------------------------------
// Outils communs
// ---------------------------------------------------------------------------

/**
 * Événements d'un même type, datés de `at`. Les comptes ignorés sont enregistrés aussi (masqués
 * à l'affichage, comme dans les notifications) : leur historique reste juste s'ils ne le sont plus.
 * Nom et « tu le suis » viennent du cache des profils ; `fallback` sert quand le profil est inconnu.
 */
function makeEvents(
  type: FollowEvent['type'],
  profileIds: readonly string[],
  at: number,
  profiles: ProfileCache,
  fallback?: (profileId: string) => Pick<FollowEvent, 'handle' | 'mutual'> | undefined,
): FollowEvent[] {
  return profileIds.map((profileId) => {
      const p = profiles[profileId];
      const f = fallback?.(profileId);
      return {
        id: eventId(type, profileId, at),
        type,
        profileId,
        handle: p?.handle ?? f?.handle ?? profileId,
        at,
        status: 'active',
        mutual: p?.following ?? f?.mutual ?? false,
        seen: false, // « Nouveau » jusqu'à son premier affichage
      };
    });
}

/**
 * Ajoute des mouvements à l'historique, sauf ceux déjà enregistrés : un compte dont le dernier
 * mouvement connu est déjà du même type (scan rejoué, sauvegarde plus ancienne que la liste…).
 * Le tri se fait sur l'historique au moment de l'écriture. Renvoie les événements ajoutés.
 */
async function addEvents(
  accountId: string,
  candidates: FollowEvent[],
  ignored: ReadonlySet<string>,
): Promise<FollowEvent[]> {
  if (candidates.length === 0) return [];
  let added: FollowEvent[] = [];
  await updateEvents(accountId, (events) => {
    added = candidates
      .filter((e) => newMovements(e.type, [e.profileId], events).length > 0)
      // Compte ignoré : enregistré déjà « vu », il ne remontera pas comme nouveau s'il ne l'est plus.
      .map((e) => (ignored.has(e.profileId) ? { ...e, seen: true } : e));
    return [...added, ...events];
  });
  return added;
}

const departuresOf = (events: FollowEvent[]) => events.filter((e) => e.type === 'departure');

/** Notifie les départs visibles selon les réglages du compte (comptes ignorés, mutuels seulement). */
async function notifyVisible(account: TrackedAccount, departures: FollowEvent[], ignored: ReadonlySet<string>) {
  const ctx = { ignored, mutualsOnly: account.mutualsOnly };
  await notifyDepartures(account.handle, departures.filter((d) => isVisible(d, ctx)));
}

/** Dernière vérification (la liste d'abonnés enregistrée est à jour jusque-là). */
const lastCheck = (account: TrackedAccount) => account.lastScanAt ?? 0;

/**
 * Réparation : ajoute les mouvements manquants quand l'historique contredit la liste
 * d'abonnés (ex. un départ perdu). Renvoie les départs ajoutés (pour la notification).
 */
async function repairHistory(
  accountId: string,
  followers: readonly string[],
  before: number,
  ignored: ReadonlySet<string>,
  profiles: ProfileCache,
  now: number,
): Promise<FollowEvent[]> {
  if (!before) return [];
  const fixes = missingMovements(await loadEvents(accountId), new Set(followers), before);
  const byId = new Map(fixes.map((m) => [m.profileId, m.from]));
  const added = (['departure', 'arrival'] as const).flatMap((type) =>
    makeEvents(
      type,
      fixes.filter((m) => m.type === type).map((m) => m.profileId),
      now,
      profiles,
      (id) => byId.get(id),
    ),
  );
  return departuresOf(await addEvents(accountId, added, ignored));
}

// ---------------------------------------------------------------------------
// Scan complet
// ---------------------------------------------------------------------------

const coverageOf = (job: ScanJob, at: number): ScanCoverage => {
  const scanned = job.count ?? Object.keys(job.collected).length;
  const detected = job.expectedTotal;
  // Pages perdues en cours de route (service worker relancé) : jamais complet, à reprendre.
  const complete = !job.gap && isComplete({ scanned, detected, reachedEnd: job.reachedEnd, seeded: job.seeded, totalKnown: job.totalSeen });
  return { at, detected, scanned, complete };
};

/**
 * Scan incomplet ou interrompu (§ 4.3, 4.7) : rien n'est comparé, l'instantané précédent reste
 * la référence. Les abonnés récupérés sont gardés pour « Continuer le scan » (union).
 */
export async function saveIncomplete(job: ScanJob): Promise<ScanCoverage> {
  const coverage = { ...coverageOf(job, Date.now()), complete: false };
  if (job.kind !== 'quick') {
    await savePartial(job.accountId, {
      kind: job.kind,
      at: coverage.at,
      expectedTotal: job.expectedTotal,
      collected: job.collected,
    });
  }
  await patchAccount(job.accountId, { lastScan: coverage });
  return coverage;
}

/** Ids du scan dans l'ordre de x.com ; les abonnés repris d'un passage précédent vont en fin. */
function orderedIds(job: ScanJob): string[] {
  const order = job.top ?? [];
  const seen = new Set(order);
  return [...order, ...Object.keys(job.collected).filter((id) => !seen.has(id))];
}

export async function applyScan(job: ScanJob): Promise<ApplyOutcome> {
  const now = Date.now();
  const accountId = job.accountId;
  const [previous, cachedProfiles, accounts] = await Promise.all([
    loadSnapshot(accountId),
    loadProfiles(accountId),
    loadAccounts(),
  ]);
  const account = accounts[accountId];
  // Arrêt anticipé : la partie relue, puis la suite de l'ancienne liste, inchangée. Refusé si
  // des pages ont été perdues (`gap`) : leurs abonnés passeraient pour des départs.
  const early = job.earlyStop && previous?.ordered && !job.gap ? job.earlyStop : undefined;
  const read = orderedIds(job);
  // Fin de liste jamais atteinte (chargement bloqué malgré une couverture suffisante) : la suite
  // non relue est reprise de l'ancienne liste au lieu d'être déclarée partie.
  const tailFilled = !early && !job.reachedEnd && !!previous?.ordered;
  const ids = early
    ? assembleOrder(previous!.ids, read, early.matchedIndex)
    : tailFilled
      ? fillUnreadTail(previous!.ids, read)
      : read;

  // Un scan incomplet produirait de fausses arrivées puis de faux départs (§ 4.7).
  const coverage: ScanCoverage = early
    ? { at: now, detected: job.expectedTotal, scanned: ids.length, complete: true, stoppedAt: read.length }
    : coverageOf(job, now);
  if (!coverage.complete) return { kind: 'incomplete', coverage: await saveIncomplete(job) };
  // Enregistré une fois le résultat accepté (pas pour un résultat suspect, qui sera refait).
  const recordCoverage = () =>
    Promise.all([
      clearPartial(accountId),
      // Scan relu de bout en bout (manuel, de contrôle, de référence…) : le compteur des
      // contrôles légers repart de zéro. Un arrêt anticipé, ou une fin de liste non relue
      // (reprise de l'ancienne liste), ne compte pas : le scan de contrôle reste dû.
      patchAccount(accountId, { lastScan: coverage, ...(early || tailFilled ? {} : { quickSinceFull: 0 }) }),
    ]);

  // Le cache garde aussi les profils partis : on en a besoin pour afficher les départs.
  const profiles: ProfileCache = { ...cachedProfiles, ...job.collected };
  const followersCount = job.expectedTotal || ids.length;
  const saveAll = () =>
    Promise.all([
      saveSnapshot(accountId, {
        at: now,
        ids,
        total: ids.length,
        xTotal: followersCount,
        top: ids.slice(0, SNAPSHOT_TOP_SIZE),
        ordered: true,
      }),
      saveProfiles(accountId, profiles),
      localKv.remove(keys.suspicious(accountId)),
    ]);

  // Scan de référence (pas encore d'instantané) : aucune alerte.
  if (job.kind === 'baseline' || !previous || !account) {
    await recordCoverage();
    await saveAll();
    await updateAccountAfterScan(accountId, now, followersCount, true);
    return { kind: 'baseline' };
  }

  const diff = diffFollowers(previous.ids, ids);
  const verdict = assessScan({
    previousCount: previous.ids.length,
    collected: ids.length,
    expected: job.expectedTotal,
    departures: diff.departures.length,
  });
  if (verdict === 'suspicious') {
    const runs = ((await localKv.get<number>(keys.suspicious(accountId))) ?? 0) + 1;
    if (runs < SUSPICIOUS_MAX_RETRIES) {
      // La nouvelle vérification relit toute la liste : pas de reprise d'un scan partiel,
      // dont les abonnés partis depuis masqueraient de vrais départs.
      await Promise.all([localKv.set({ [keys.suspicious(accountId)]: runs }), clearPartial(accountId)]);
      return { kind: 'retry', reason: 'suspicious', at: now + SUSPICIOUS_RETRY_MS };
    }
    // Même résultat plusieurs fois de suite : la variation est réelle.
  }
  await recordCoverage();

  const ignored = await loadIgnored(accountId);
  // Écart repéré par un contrôle léger et pas encore identifié : quel que soit le scan qui les
  // identifie (suivi automatique, « Identifier », scan complet…), les départs gardent la date
  // de cette première détection. Sans écart en attente, ils sont datés de la comparaison.
  const departedAt = account.pending?.at ?? now;
  // Mouvements déjà enregistrés dans l'historique : écartés par addEvents (pas de doublon).
  const added = await addEvents(accountId, [
    ...makeEvents('departure', diff.departures, departedAt, cachedProfiles),
    ...makeEvents('arrival', diff.arrivals, now, job.collected),
  ], ignored);
  const departures = departuresOf(added);
  await saveAll();
  const repaired = await repairHistory(accountId, ids, lastCheck(account), ignored, profiles, now);
  await updateAccountAfterScan(accountId, now, followersCount, false);

  await notifyVisible(account, [...departures, ...repaired], ignored);
  return { kind: 'compared', departures: departures.length, arrivals: added.length - departures.length };
}

async function updateAccountAfterScan(
  accountId: string,
  at: number,
  followersCount: number,
  isBaseline: boolean,
): Promise<void> {
  const current = (await loadAccounts())[accountId];
  await recordTotal(accountId, followersCount, at);
  await patchAccount(accountId, {
    lastScanAt: at,
    followersCount,
    pending: undefined,
    // Référence obtenue : les essais automatiques du scan de référence s'arrêtent là.
    ...(isBaseline ? { baselineRetry: undefined } : {}),
    // La date de référence d'origine est conservée (sauvegarde importée) ; § 4.5.
    ...(isBaseline && !current?.baselineAt ? { baselineAt: at } : {}),
  });
}

// ---------------------------------------------------------------------------
// Contrôle léger
// ---------------------------------------------------------------------------

/**
 * Fin d'un contrôle léger : enregistre les nouveaux abonnés vus en tête de liste et les
 * départs récents identifiés ; signale les départs plus anciens (scan complet) quand le
 * total baisse sans explication.
 */
export async function applyQuickCheck(job: ScanJob): Promise<QuickOutcome> {
  const now = Date.now();
  const accountId = job.accountId;
  const [previous, cachedProfiles, accounts, ignored] = await Promise.all([
    loadSnapshot(accountId),
    loadProfiles(accountId),
    loadAccounts(),
    loadIgnored(accountId),
  ]);
  const account = accounts[accountId];
  // Première page dans l'ordre de x.com (les clés de `collected` ne gardent pas l'ordre).
  const pageIds = job.top?.length ? job.top : Object.keys(job.collected);
  if (!previous || !account || !job.totalSeen || pageIds.length === 0) return { kind: 'skipped' };

  const previousTotal = previous.xTotal ?? job.baseTotal ?? previous.total;
  const quick = assessQuick({
    previousTotal,
    currentTotal: job.expectedTotal,
    knownIds: new Set(previous.ids),
    pageIds,
    previousTop: previous.top ?? (previous.ordered ? previous.ids.slice(0, SNAPSHOT_TOP_SIZE) : undefined),
  });

  const profiles: ProfileCache = { ...cachedProfiles, ...job.collected };

  // --- Instantané : arrivées en tête, départs identifiés retirés (ordre de x.com conservé) ---
  const departedSet = new Set(quick.departed);
  const remaining = previous.ids.filter((id) => !departedSet.has(id));
  const ids = [...quick.arrivals, ...remaining];
  const pageSet = new Set(pageIds);

  // Compteur X en retard sur la liste : on revérifie plus tard au lieu de lancer un scan complet.
  // Le total attendu devient la référence ; si X ne le rattrape pas après quelques contrôles,
  // l'écart est réel et le scan complet a lieu.
  // Analyse rejouée après un arrêt du service worker : le compte a déjà été mis à jour par ce
  // contrôle (écart, compteurs) ; on reprend son verdict au lieu de tout recompter.
  const replayed = account.lastQuick?.job === job.startedAt ? account.lastQuick : undefined;
  const previousStale = account.lastQuick?.staleRuns ?? 0;
  const lagging = replayed
    ? replayed.staleRuns !== undefined
    : quick.missing > 0 &&
    !quick.overflow &&
    previousStale < MAX_STALE_RUNS &&
    (quick.maybeStale ||
      // Revérification : toujours aucun nouveau, et le total X n'a pas baissé depuis le contrôle précédent.
      (previousStale > 0 && quick.arrivals.length === 0 && job.expectedTotal >= (account.lastQuick?.total ?? Infinity)));

  // Écart à identifier enregistré avant l'instantané : si le service worker s'arrête entre
  // les deux, l'écart n'est pas perdu (l'ancien instantané reste la référence).
  const found = !lagging && (quick.missing > 0 || quick.overflow);
  // Total de X relevé pour la courbe des abonnés (pas quand il est en retard sur la liste).
  if (!lagging) await recordTotal(accountId, job.expectedTotal, now);
  if (!replayed) await patchAccount(accountId, {
    lastScanAt: now,
    followersCount: job.expectedTotal,
    pending: found
      ? {
          count: (account.pending?.count ?? 0) + quick.missing,
          at: account.pending?.at ?? now,
          full: quick.overflow || account.pending?.full || undefined,
        }
      : account.pending,
    quickSinceFull: (account.quickSinceFull ?? 0) + 1,
    lastQuick: {
      at: now,
      arrivals: quick.arrivals.length,
      departed: quick.departed.length,
      missing: lagging ? 0 : quick.missing,
      overflow: quick.overflow,
      total: job.expectedTotal,
      staleRuns: lagging ? previousStale + 1 : undefined,
      job: job.startedAt,
    },
  });
  const departures = departuresOf(
    await addEvents(accountId, [
      ...makeEvents('departure', quick.departed, now, cachedProfiles),
      ...makeEvents('arrival', quick.arrivals, now, job.collected),
    ], ignored),
  );
  await Promise.all([
    saveSnapshot(accountId, {
      at: previous.at,
      ids,
      total: ids.length,
      xTotal: lagging ? previousTotal + quick.arrivals.length - quick.departed.length : job.expectedTotal,
      top: previous.ordered
        ? [...pageIds, ...remaining.filter((id) => !pageSet.has(id))].slice(0, SNAPSHOT_TOP_SIZE)
        : [...pageIds],
      ordered: previous.ordered,
    }),
    saveProfiles(accountId, profiles),
  ]);
  const repaired = await repairHistory(accountId, ids, lastCheck(account), ignored, profiles, now);

  await notifyVisible(account, [...departures, ...repaired], ignored);

  if (lagging) return { kind: 'recheck', at: now + STALE_RECHECK_MS };
  if (!found) return { kind: 'clear', arrivals: quick.arrivals.length };
  // Départs plus anciens non identifiés : le scan complet est lancé aussitôt par l'orchestrateur.
  return { kind: 'pending', missing: quick.missing, full: quick.overflow };
}
