import { loadAccounts, loadIgnored, patchAccount } from '@/features/accounts/repository';
import { notifyDepartures } from '@/features/alerts/notifications';
import { eventId } from '@/domain/events/codec';
import { loadEvents, loadRemoved, updateEvents } from '@/features/events/repository';
import { isVisible, missingMovements, newMovements, wasRemoved } from '@/domain/events/selectors';
import {
  enqueueFollowChecks,
  recordTotal,
  clearPartial,
  loadProfiles,
  loadSnapshot,
  savePartial,
  saveProfiles,
  saveSnapshot,
} from '@/features/followers-sync/repository';
import { localKv } from '@/shared/storage/kv';
import { keys } from '@/shared/storage/keys';
import type {
  FollowCheck,
  FollowCheckResult,
  FollowEvent,
  ProfileCache,
  ScanCoverage,
  ScanJob,
  Snapshot,
  TrackedAccount,
} from '@/shared/types';
import {
  assembleOrder,
  assessQuick,
  assessScan,
  departuresExplained,
  diffFollowers,
  fillUnreadTail,
  isComplete,
  reachesCoverage,
  SUSPICIOUS_MAX_RETRIES,
  type QuickAssessment,
} from '@/domain/followers/diff';
import { cleanFalseMovements } from './cleanup';
import { SNAPSHOT_TOP_SIZE, STALE_RECHECK_MS } from '@/features/followers-sync/model';
import { MINUTE } from '@/shared/utils/time';

/**
 * Exploitation des scans (§ 4.1, 4.2, 4.7) : référence, comparaison, garde-fous,
 * événements, instantané et notifications.
 * Chaque départ est ensuite mis en file pour vérifier son follow back sur son profil
 * (voir follow-check) : le cache des profils peut dater du scan de référence.
 */

const SUSPICIOUS_RETRY_MS = 30 * MINUTE;
/** Nombre de contrôles « total X en retard » tolérés avant de lancer un scan complet. */
const MAX_STALE_RUNS = 3;
/** Entrées de X illisibles tolérées (au moins ce nombre, ou cette part de la liste). */
const SKIPPED_MIN = 5;
const SKIPPED_RATIO = 0.001;

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

/** Départs à vérifier sur leur profil (follow back) ; les comptes ignorés ne sont pas ouverts. */
const queueFollowChecks = (accountId: string, departures: readonly FollowEvent[], ignored: ReadonlySet<string>) =>
  enqueueFollowChecks(
    accountId,
    departures
      .filter((d) => !ignored.has(d.profileId))
      .map((d): FollowCheck => ({ eventId: d.id, profileId: d.profileId, handle: d.handle })),
  );

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
  const removed = await loadRemoved(accountId);
  const fixes = missingMovements(await loadEvents(accountId), new Set(followers), before).filter((m) => !wasRemoved(m, removed));
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
  // Trop d'entrées illisibles (format de X modifié) : ces abonnés passeraient pour des départs.
  const unreadable = (job.skipped ?? 0) > Math.max(SKIPPED_MIN, scanned * SKIPPED_RATIO);
  const complete =
    !job.gap &&
    !unreadable &&
    isComplete({
      scanned,
      detected,
      reachedEnd: job.reachedEnd,
      seeded: job.seeded,
      reread: job.top?.length,
      totalKnown: job.totalSeen,
    });
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
      // Date de lecture la plus ancienne : la sauvegarde ne rajeunit pas ces abonnés.
      at: job.seededAt ?? job.startedAt,
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

/** Liste d'abonnés issue d'un scan, complétée par l'ancienne liste si besoin (fonction pure). */
function scanList(job: ScanJob, previous: Snapshot | undefined) {
  // Arrêt anticipé : la partie relue, puis la suite de l'ancienne liste, inchangée. Refusé si
  // des pages ont été perdues (`gap`) ou des entrées illisibles : leurs abonnés passeraient pour
  // des départs.
  const early = job.earlyStop && previous?.ordered && !job.gap && !job.skipped ? job.earlyStop : undefined;
  const read = orderedIds(job);
  // Fin de liste jamais atteinte (chargement bloqué malgré une couverture suffisante), ou annoncée
  // sous la couverture d'un scan complet : la suite non relue est reprise de l'ancienne liste au
  // lieu d'être déclarée partie.
  const coverageReached = job.expectedTotal <= 0 || reachesCoverage(job.count ?? read.length, job.expectedTotal);
  const tailFilled = !early && !!previous?.ordered && (!job.reachedEnd || !coverageReached);
  const ids =
    early && previous
      ? assembleOrder(previous.ids, read, early.matchedIndex)
      : tailFilled && previous
        ? fillUnreadTail(previous.ids, read)
        : read;
  return { early, read, tailFilled, ids };
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
  const { early, read, tailFilled, ids } = scanList(job, previous);

  // Un scan incomplet produirait de fausses arrivées puis de faux départs (§ 4.7).
  const coverage: ScanCoverage = early
    ? { at: now, detected: job.expectedTotal, scanned: ids.length, complete: true, stoppedAt: read.length }
    : coverageOf(job, now);
  // Fin de liste non lue et rien pour compléter : les abonnés non lus passeraient pour partis.
  const unreadEnd = !early && !job.reachedEnd && !tailFilled;
  if (!coverage.complete || unreadEnd) return { kind: 'incomplete', coverage: await saveIncomplete(job) };
  // Enregistré une fois le résultat accepté (pas pour un résultat suspect, qui sera refait).
  const recordCoverage = () =>
    Promise.all([
      clearPartial(accountId),
      // Scan relu de bout en bout (manuel, de contrôle, de référence…) : le compteur des
      // contrôles légers repart de zéro. Un arrêt anticipé, une fin de liste non relue (reprise de
      // l'ancienne liste) ou une reprise de scan ne comptent pas : le scan de contrôle reste dû.
      patchAccount(accountId, { lastScan: coverage, ...(early || tailFilled || job.seeded ? {} : { quickSinceFull: 0 }) }),
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
        // Abonnés repris, ou relecture depuis le haut : l'ordre n'est pas celui de x.com.
        ordered: !job.seeded && !job.unordered,
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
  // Départs que la baisse du total X n'explique pas : la liste lue est coupée, rien n'est comparé.
  // Le total de l'instantané a déjà baissé de l'écart en attente repéré par le contrôle léger.
  const explained = departuresExplained({
    previousTotal: (previous.xTotal ?? previous.total) + (account.pending?.count ?? 0),
    currentTotal: job.expectedTotal,
    arrivals: diff.arrivals.length,
    departures: diff.departures.length,
    previousCount: previous.ids.length,
  });
  const unexplained = !!job.totalSeen && !explained;
  const verdict = assessScan({ previousCount: previous.ids.length, departures: diff.departures.length });
  if (unexplained || verdict === 'suspicious') {
    const runs = ((await localKv.get<number>(keys.suspicious(accountId))) ?? 0) + 1;
    // Sans total lu pendant ce scan, rien ne confirme la variation : jamais acceptée par répétition.
    if (runs >= SUSPICIOUS_MAX_RETRIES && !job.totalSeen) {
      return { kind: 'incomplete', coverage: await saveIncomplete(job) };
    }
    // X peut garder dans son total des comptes suspendus : le même résultat, relu en entier
    // plusieurs fois, est réel. Sans cette sortie, la détection resterait figée.
    const readInFull = !early && !job.seeded;
    if (runs < SUSPICIOUS_MAX_RETRIES || (unexplained && !readInFull)) {
      // La nouvelle vérification relit toute la liste : pas de reprise d'un scan partiel,
      // dont les abonnés partis depuis masqueraient de vrais départs.
      await Promise.all([
        localKv.set({ [keys.suspicious(accountId)]: Math.min(runs, SUSPICIOUS_MAX_RETRIES) }),
        clearPartial(accountId),
      ]);
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

  await queueFollowChecks(accountId, [...departures, ...repaired], ignored);
  await notifyVisible(account, [...departures, ...repaired], ignored);
  // Après la notification : un échec ici n'a pas à remettre en cause le scan.
  await cleanFalseMovements(accountId).catch((err) => console.error(err));
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
    quickFailures: undefined,
    // Référence obtenue : les essais automatiques du scan de référence s'arrêtent là.
    ...(isBaseline ? { baselineRetry: undefined } : {}),
    // La date de référence d'origine est conservée (sauvegarde importée) ; § 4.5.
    ...(isBaseline && !current?.baselineAt ? { baselineAt: at } : {}),
  });
}

// ---------------------------------------------------------------------------
// Contrôle léger
// ---------------------------------------------------------------------------

const sameList = (a: readonly string[] | undefined, b: readonly string[] | undefined) =>
  a === b || (!!a && !!b && a.length === b.length && a.every((id, i) => id === b[i]));

const sameSnapshot = (a: Snapshot, b: Snapshot) => a.xTotal === b.xTotal && sameList(a.ids, b.ids) && sameList(a.top, b.top);

/** Un profil lu diffère de ceux déjà enregistrés. */
const profilesChanged = (cached: ProfileCache, read: ProfileCache) =>
  Object.entries(read).some(([id, p]) => {
    const known = cached[id];
    return !known || known.handle !== p.handle || known.name !== p.name || known.avatar !== p.avatar || known.following !== p.following;
  });

/** Compteur X en retard sur la liste (fonction pure) : il faut revérifier plus tard. */
function isLagging(quick: QuickAssessment, last: TrackedAccount['lastQuick'], currentTotal: number): boolean {
  const staleRuns = last?.staleRuns ?? 0;
  if (quick.missing <= 0 || quick.overflow || staleRuns >= MAX_STALE_RUNS) return false;
  // Revérification : toujours aucun nouveau, et le total X n'a pas baissé depuis le contrôle précédent.
  return quick.maybeStale || (staleRuns > 0 && quick.arrivals.length === 0 && currentTotal >= (last?.total ?? Infinity));
}

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
  const pageSet = new Set(pageIds);
  const ids = [...quick.arrivals, ...remaining];

  // Compteur X en retard sur la liste : on revérifie plus tard au lieu de lancer un scan complet.
  // Le total attendu devient la référence ; si X ne le rattrape pas après quelques contrôles,
  // l'écart est réel et le scan complet a lieu.
  // Analyse rejouée après un arrêt du service worker : le compte a déjà été mis à jour par ce
  // contrôle (écart, compteurs) ; on reprend son verdict au lieu de tout recompter.
  const replayed = account.lastQuick?.job === job.startedAt ? account.lastQuick : undefined;
  const previousStale = account.lastQuick?.staleRuns ?? 0;
  const lagging = replayed ? replayed.staleRuns !== undefined : isLagging(quick, account.lastQuick, job.expectedTotal);

  // Écart à identifier enregistré avant l'instantané : si le service worker s'arrête entre
  // les deux, l'écart n'est pas perdu (l'ancien instantané reste la référence).
  const found = !lagging && (quick.missing > 0 || quick.overflow);
  // Total de X relevé pour la courbe des abonnés (pas quand il est en retard sur la liste).
  if (!lagging) await recordTotal(accountId, job.expectedTotal, now);
  if (!replayed) await patchAccount(accountId, {
    quickFailures: undefined,
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
  const snapshot: Snapshot = {
    at: previous.at,
    ids,
    total: ids.length,
    xTotal: lagging ? previousTotal + quick.arrivals.length - quick.departed.length : job.expectedTotal,
    top: previous.ordered
      ? [...pageIds, ...remaining.filter((id) => !pageSet.has(id))].slice(0, SNAPSHOT_TOP_SIZE)
      : [...pageIds],
    ordered: previous.ordered,
  };
  // Ces deux clés font plusieurs Mo : rien n'est réécrit pour un contrôle sans changement.
  await Promise.all([
    sameSnapshot(previous, snapshot) ? undefined : saveSnapshot(accountId, snapshot),
    profilesChanged(cachedProfiles, job.collected) ? saveProfiles(accountId, profiles) : undefined,
  ]);
  const repaired = await repairHistory(accountId, ids, lastCheck(account), ignored, profiles, now);

  await queueFollowChecks(accountId, [...departures, ...repaired], ignored);
  await notifyVisible(account, [...departures, ...repaired], ignored);

  if (lagging) return { kind: 'recheck', at: now + STALE_RECHECK_MS };
  if (!found) return { kind: 'clear', arrivals: quick.arrivals.length };
  // Départs plus anciens non identifiés : le scan complet est lancé aussitôt par l'orchestrateur.
  return { kind: 'pending', missing: quick.missing, full: quick.overflow };
}

// ---------------------------------------------------------------------------
// Vérification du follow back des départs
// ---------------------------------------------------------------------------

/**
 * Résultats d'une passe de vérification : « je le suis » mis à jour sur chaque départ (état lu
 * sur son profil), et dans le cache des profils. Avec « Uniquement les follow back », un départ
 * qui s'avère suivi et n'a pas encore été vu est notifié maintenant (il avait été filtré).
 */
export async function applyFollowChecks(accountId: string, results: readonly FollowCheckResult[]): Promise<void> {
  if (results.length === 0) return;
  const known = new Map(results.flatMap((r) => (r.following === undefined ? [] : [[r.eventId, r.following] as const])));
  const nowFollowed: FollowEvent[] = [];
  if (known.size) {
    await updateEvents(accountId, (events) =>
      events.map((e) => {
        const following = known.get(e.id);
        if (following === undefined || following === e.mutual || e.type !== 'departure') return e;
        const updated = { ...e, mutual: following };
        if (following) nowFollowed.push(updated);
        return updated;
      }),
    );
  }

  const read = results.filter((r) => r.profile);
  if (read.length) {
    const profiles = await loadProfiles(accountId);
    for (const r of read) {
      const cached = profiles[r.profileId];
      const fresh = r.profile!;
      profiles[r.profileId] = {
        ...cached,
        ...fresh,
        avatar: fresh.avatar ?? cached?.avatar,
        following: r.following ?? cached?.following ?? false,
      };
    }
    await saveProfiles(accountId, profiles);
  }

  const account = (await loadAccounts())[accountId];
  if (account?.mutualsOnly && nowFollowed.length) {
    await notifyVisible(account, nowFollowed.filter((e) => !e.seen), await loadIgnored(accountId));
  }
}
