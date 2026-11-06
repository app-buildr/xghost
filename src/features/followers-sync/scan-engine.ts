import { exceedsFollowerLimit } from '@/domain/accounts/limit';
import { hasKnownHandle } from '@/domain/accounts/model';
import { loadAccounts, patchAccount } from '@/features/accounts/repository';
import { clearQuickTimeout } from '@/features/scheduler/alarms';
import { belowResumedFloor, earlyStop, orderIndex } from '@/domain/followers/diff';
import { isRateLimited, parseFollowersPage, parseUserLookup, variablesOf, watchedOperation } from '@/features/x-api/parse';
import { readSession } from '@/features/x-api/session';
import { t } from '@/shared/i18n';
import { SCAN_MARKER, type TabEvent } from '@/shared/messaging/protocol';
import { isImporting } from '@/shared/storage/import-lock';
import { keys } from '@/shared/storage/keys';
import { localKv } from '@/shared/storage/kv';
import type { ScanJob, ScanKind, ScanReason, TrackedAccount } from '@/shared/types';
import { HOUR, SECOND } from '@/shared/utils/time';
import { followersUrl, profileUrl, userIdUrl } from '@/shared/x-urls';
import { loadPartial, loadSnapshot } from './repository';
import { finish } from './scan-analysis';
import { scanHooks, serial } from './scan-context';
import { closeAndPause, discardQuick, finalizeIncomplete, interrupt, pause, pauseForRateLimit } from './scan-lifecycle';
import { decideStall, isStalled, mergePage, shouldPersist } from './scan-state';
import { dropJob, getJob, liveOf, putJob } from './scan-store';
import { closeTab, getScanTab, isHooked, navigate, registerScanTab, send, sendVeil, tabExists } from './scan-tab';

export { recoverFinishing, settleAnalyses } from './scan-analysis';
export { setScanHooks, type ScanHooks } from './scan-context';

/**
 * Moteur de scan par onglet (§ 4.6).
 *
 * X exige un jeton anti-bot généré par son propre code : xGhost ne fait donc
 * aucune requête. Il ouvre la liste des abonnés dans x.com et lit les réponses
 * que la page reçoit.
 *
 * - Scan complet : onglet x.com épinglé en arrière-plan, recouvert d'un overlay, qui
 *   fait défiler la liste jusqu'au bout (ou jusqu'aux départs annoncés) puis se ferme.
 *   Le rendu de l'onglet caché est simulé (voir hidden-render).
 * - Contrôle léger : onglet épinglé en arrière-plan lui aussi, sans défilement ;
 *   seuls le total annoncé et la première page (les plus récents) sont lus.
 */

/** Réponses en erreur d'affilée pour la liste : x.com refuse de la charger (limite non annoncée). */
const MAX_FAILED_PAGES = 3;
/** Pauses d'affilée pour ce motif : x.com ne donne plus la liste (format changé), le scan s'arrête. */
const MAX_FAILURE_CYCLES = 3;
/** Attente du total annoncé par X sur la page de profil, avant de revenir à la liste. */
const TOTAL_LOOKUP_MS = 10 * SECOND;

/** Abonnés repris d'un scan incomplet : au-delà de cet âge, ils ne sont plus fiables (départs depuis). */
const SEED_MAX_AGE_MS = 24 * HOUR;
/**
 * Arrêt anticipé : pages relues en plus une fois les départs annoncés trouvés. Le total de X
 * compte des comptes qu'il n'affiche pas : l'écart peut sous-estimer les départs réels.
 */
const EARLY_STOP_MARGIN_PAGES = 2;

const clearPause = (job: ScanJob) => {
  job.status = 'running';
  job.pausedReason = undefined;
  job.resumeAt = undefined;
  job.failedPages = undefined;
  job.xError = undefined;
};

// ---------------------------------------------------------------------------
// Onglet de scan
// ---------------------------------------------------------------------------

const scanFollowersUrl = (account: TrackedAccount) =>
  `${hasKnownHandle(account) ? followersUrl(account.handle) : userIdUrl(account.id)}#${SCAN_MARKER}`;

/** Profil du compte (contrôle léger : lecture du total), dans l'onglet de scan. */
const profileScanUrl = (account: TrackedAccount) => `${profileUrl(account.handle)}#${SCAN_MARKER}`;

const isFollowersPath = (path: string, handle: string) => path.toLowerCase() === `/${handle.toLowerCase()}/followers`;

/** x.com a redirigé l'onglet de scan vers la connexion : session absente (§ 4.6). */
const isLoginPath = (path: string) => /^\/(login|logout|i\/flow\/login|i\/flow\/signup)(\/|$)/.test(path);

async function openTab(job: ScanJob, account: TrackedAccount): Promise<void> {
  // Un seul onglet de scan à la fois : celui d'un autre compte est fermé et son scan mis en pause
  // (il reprendra quand ce compte sera de nouveau connecté).
  const previous = await getScanTab();
  if (previous && previous.accountId !== job.accountId) {
    const other = await getJob(previous.accountId);
    if (other && !other.finishing) {
      if (other.kind === 'quick') await discardQuick(other);
      else {
        await closeAndPause(other, 'account-switched');
      }
    } else await chrome.tabs.remove(previous.tabId).catch(() => undefined);
  }
  const url = scanFollowersUrl(account);
  // Scan complet comme contrôle léger (§ 4.6) : onglet épinglé, en arrière-plan. Il tient dans une
  // petite pastille à gauche, est difficile à fermer par erreur et se ferme tout seul à la fin.
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => undefined);
  const tab = await chrome.tabs.create({ url, pinned: true, active: false, windowId: win?.id });
  if (tab.id === undefined) throw new Error(t('common.scan.tabOpenFailed'));
  await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => undefined);
  job.tabId = tab.id;
  job.lastProgressAt = Date.now();
  job.retriedAt = undefined;
  await registerScanTab(tab.id, job.accountId);
}

// ---------------------------------------------------------------------------
// États du scan
// ---------------------------------------------------------------------------

/** Démarre un scan (ou reprend celui qui existe) pour le compte connecté. */
export async function startScan(
  account: TrackedAccount,
  kind: ScanKind,
  reason?: ScanReason,
  target?: number,
): Promise<void> {
  return serial(async () => {
    if (isImporting()) return; // données en cours de remplacement
    let job = await getJob(account.id);
    // Un contrôle léger en cours ne remplace pas un scan complet demandé : on l'abandonne.
    // (Un scan complet en cours couvre au contraire un contrôle léger : il est repris.)
    if (job?.kind === 'quick' && kind !== 'quick' && !job.finishing) {
      await discardQuick(job);
      job = undefined;
    }
    if (!job) {
      const now = Date.now();
      // « Continuer le scan » (§ 4.7) : les abonnés d'un scan incomplet récent sont repris (union).
      const partial = kind === 'quick' ? undefined : await loadPartial(account.id);
      const fresh = partial && now - partial.at < SEED_MAX_AGE_MS;
      const seed = fresh && (partial.kind === kind || kind === 'baseline') ? partial.collected : {};
      const seeded = Object.keys(seed).length;
      job = {
        accountId: account.id,
        kind,
        status: 'running',
        startedAt: now,
        updatedAt: now,
        pages: 0,
        collected: { ...seed },
        count: seeded,
        seeded,
        seededAt: seeded ? partial?.at : undefined,
        expectedTotal: account.followersCount ?? 0,
        baseTotal: account.followersCount,
        visible: kind !== 'quick',
        reason: kind === 'quick' ? 'quick' : reason,
        target: kind === 'quick' ? undefined : target,
      };
    }
    await ensureTab(job, account);
  });
}

/** Reprend un scan en pause ou dont l'onglet a disparu. Renvoie vrai si un scan repart. */
export async function resumeScan(accountId: string): Promise<boolean> {
  return serial(async () => {
    const job = await getJob(accountId);
    const account = (await loadAccounts())[accountId];
    if (!job || !account || job.finishing) return false;
    if (job.kind === 'quick') {
      await discardQuick(job); // contrôle léger périmé : le prochain le remplacera
      return false;
    }
    // Scan abandonné depuis plusieurs jours (autre compte, Chrome fermé) : sa liste n'est plus fiable. Rien
    // n'est gardé pour « Continuer le scan », elle masquerait les départs survenus depuis.
    if (Date.now() - job.updatedAt > SEED_MAX_AGE_MS) {
      await closeTab(job);
      await dropJob(job.accountId);
      await scanHooks().onStateChange();
      return false;
    }
    if (job.pausedReason === 'rate-limit' && (await tabExists(job.tabId))) {
      // La limite est levée : on relance le chargement dans la page.
      clearPause(job);
      job.lastProgressAt = Date.now();
      job.retriedAt = Date.now();
      await putJob(job);
      await scanHooks().onStateChange();
      // Page rechargée pendant la pause, service worker arrêté : son script de page a disparu.
      if (!(await isHooked(job.tabId!))) await reopenWithHook(job.tabId!, scanFollowersUrl(account));
      await send(job.tabId!, 'retry');
      await send(job.tabId!, 'drive-start');
      await sendVeil(job, account);
      return true;
    }
    await ensureTab(job, account);
    return true;
  });
}

/** Rouvre la page avec le fragment. Sur la même page, seul le fragment changerait : on recharge. */
async function reopenWithHook(tabId: number, url: string): Promise<void> {
  const current = await chrome.tabs.get(tabId).then((tab) => tab.url, () => undefined);
  await navigate(tabId, url);
  if (current && new URL(current).pathname === new URL(url).pathname) await chrome.tabs.reload(tabId).catch(() => undefined);
}

async function ensureTab(job: ScanJob, account: TrackedAccount): Promise<void> {
  const session = await readSession();
  if (!session) return pause(job, 'disconnected');
  if (session.accountId !== job.accountId) return pause(job, 'account-switched');
  if (!(await tabExists(job.tabId))) await openTab(job, account);
  clearPause(job);
  job.updatedAt = Date.now();
  await putJob(job);
  await scanHooks().onStateChange();
}

export async function isScanActive(accountId: string): Promise<boolean> {
  const job = await getJob(accountId);
  return !!job && job.status === 'running' && (await tabExists(job.tabId));
}

/** Affiche l'onglet de scan (repli si le rendu simulé de l'onglet caché ne suffit pas). */
export function focusScanTab(accountId: string): Promise<void> {
  return serial(async () => {
    const job = await getJob(accountId);
    if (job?.tabId === undefined || job.kind === 'quick') return;
    const tab = await chrome.tabs.update(job.tabId, { active: true }).catch(() => undefined);
    if (tab?.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true }).catch(() => undefined);
    job.lastProgressAt = Date.now();
    await putJob(job, false);
  });
}

/** Abandonne un contrôle léger qui n'a pas abouti (page trop lente, onglet suspendu). Renvoie vrai si c'est le cas. */
export function abortQuick(accountId: string): Promise<boolean> {
  return serial(async () => {
    const job = await getJob(accountId);
    if (job?.kind !== 'quick' || job.finishing) return false;
    await discardQuick(job);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Événements des onglets x.com
// ---------------------------------------------------------------------------

export function handleTabEvent(event: TabEvent, tabId: number): Promise<void> {
  return serial(async () => {
    if (isImporting()) return; // données en cours de remplacement
    const scanTab = await getScanTab();
    // Onglet inconnu : jamais repris ni fermé, il n'est pas à nous (lien portant le fragment).
    if (!scanTab || scanTab.tabId !== tabId) return;
    const job = await getJob(scanTab.accountId);
    if (!job || job.tabId !== tabId || job.finishing) return;
    const account = (await loadAccounts())[job.accountId];
    if (!account) return;

    if (event.xgTab === 'ready' || event.xgTab === 'tick') {
      if (isLoginPath(event.path)) {
        await closeAndPause(job, 'disconnected');
        return;
      }
      await routeTab(job, account, tabId, event.path);
      if (event.xgTab === 'ready') await sendVeil(job, account);
      else await checkStall(job, account, event.visible);
      return;
    }

    // Seules les opérations GraphQL de x.com suivies par xGhost sont prises en compte.
    if (watchedOperation(event.url) !== event.op) return;
    if (event.op === 'Followers') await onFollowersPage(job, account, tabId, event);
    else await onProfile(job, account, tabId, event.body);
  });
}

/** Cet onglet est-il l'onglet de scan enregistré ? Après l'ouverture de l'onglet (même file). */
export function isScanTab(tabId: number): Promise<boolean> {
  return serial(async () => (await getScanTab())?.tabId === tabId);
}

/** Laisse à Chrome le temps de restaurer ses onglets après un redémarrage. */
const RESTORE_WAIT_MS = 10 * SECOND;

/**
 * Onglet de scan resté d'avant un redémarrage de Chrome : son fragment a été effacé et son id a
 * changé, il n'est plus instrumenté. À appeler avant toute reprise. Seuls les onglets épinglés sur
 * la liste du compte ou sur `/i/user/<id>` sont visés (jamais un profil, qu'on épingle soi-même) :
 * ils sont cherchés tout de suite puis une seconde fois, la restauration de Chrome pouvant finir après.
 */
export function closeRestoredScanTab(): Promise<void> {
  return serial(async () => {
    const scanTab = await getScanTab();
    if (!scanTab || (await tabExists(scanTab.tabId))) return;
    await localKv.remove(keys.scanTab);
    const account = (await loadAccounts())[scanTab.accountId];
    if (!account) return;
    const sweep = async () => {
      // Adresses exactes : `/followers_you_follow`, par exemple, n'est pas l'onglet de scan.
      const patterns = [userIdUrl(account.id), ...(hasKnownHandle(account) ? [followersUrl(account.handle)] : [])];
      const current = (await getScanTab())?.tabId;
      const pinned = await chrome.tabs.query({ pinned: true, url: patterns }).catch(() => []);
      await Promise.all(
        pinned.map((tab) => (tab.id === undefined || tab.id === current ? undefined : chrome.tabs.remove(tab.id).catch(() => undefined))),
      );
    };
    await sweep();
    setTimeout(() => void serial(sweep), RESTORE_WAIT_MS);
  });
}

/** Profil du compte (UserByScreenName / UserByRestId) : identité et total annoncé par X. */
async function onProfile(job: ScanJob, account: TrackedAccount, tabId: number, body: string): Promise<void> {
  const profile = parseJson(body, parseUserLookup)?.profile;
  if (profile?.id !== job.accountId) return;
  // Identité à jour (handle, nom, photo, total annoncé par X) : § 4.3, changement de @handle.
  // Écriture seulement si quelque chose change (évite une écriture de la liste des comptes à chaque profil).
  const followersCount = profile.followersCount ?? account.followersCount;
  const avatar = profile.avatar ?? account.avatar;
  if (
    profile.handle !== account.handle ||
    profile.name !== account.name ||
    avatar !== account.avatar ||
    followersCount !== account.followersCount
  ) {
    await patchAccount(job.accountId, { handle: profile.handle, name: profile.name, avatar, followersCount });
  }
  if (profile.followersCount !== undefined) {
    // Limite d'abonnés (§ 4.9) : testée sur le total annoncé, avant de faire défiler la liste.
    if (exceedsFollowerLimit(account, profile.followersCount)) return stopForLimit(job, profile.followersCount);
    if (account.limit) await scanHooks().onFollowerLimitCleared(job.accountId);
    job.expectedTotal = profile.followersCount;
    job.totalSeen = true;
  }
  await putJob(job, false);
  if (job.kind === 'quick' && job.totalSeen && job.pages > 0) return finish(job);
  await routeTab(job, { ...account, handle: profile.handle }, tabId);
}

/**
 * Limite d'abonnés dépassée : le scan s'arrête sans rien garder (aucune liste à continuer),
 * onglet fermé. L'orchestrateur marque le compte et coupe ses vérifications.
 */
async function stopForLimit(job: ScanJob, count: number): Promise<void> {
  await clearQuickTimeout(job.accountId);
  await closeTab(job);
  await dropJob(job.accountId);
  await scanHooks().onFollowerLimit(job, count);
  await scanHooks().onStateChange();
}

/** Page de la liste des abonnés. */
async function onFollowersPage(
  job: ScanJob,
  account: TrackedAccount,
  tabId: number,
  event: Extract<TabEvent, { xgTab: 'response' }>,
): Promise<void> {
  if (variablesOf(event.url).userId !== job.accountId) return;
  if (isRateLimited(event.status, event.body)) return pauseForRateLimit(job, account, event.rateReset);
  // Réponse en erreur, ou sans liste (erreur renvoyée avec un statut 200) : jamais une fin de liste.
  const { cursor } = variablesOf(event.url);
  const parsed = event.status >= 400 ? undefined : parseJson(event.body, (data) => parseFollowersPage(data, cursor));
  // Page vide sans curseur loin du total annoncé : réponse tronquée, pas une fin de liste. Près du
  // total, c'est la vraie fin : X compte des comptes qu'il n'affiche pas. Seul ce qui a été relu par
  // ce passage compte : les abonnés repris ne prouvent pas qu'on a atteint le bas de la liste.
  const truncated = parsed && parsed.users.length === 0 && !parsed.nextCursor && belowResumedFloor(job.top?.length ?? 0, job.expectedTotal);
  const page = truncated ? undefined : parsed;
  if (!page) {
    // Erreur ponctuelle : x.com réessaiera (le contrôle de blocage prend le relais). Plusieurs
    // d'affilée : x.com refuse la liste, comme pour une limite (pause, puis reprise).
    job.failedPages = (job.failedPages ?? 0) + 1;
    if (job.kind !== 'quick' && job.failedPages >= MAX_FAILED_PAGES) {
      job.failureCycles = (job.failureCycles ?? 0) + 1;
      // Toujours refusée après plusieurs pauses : ce n'est pas une limite de X, on arrête.
      if (job.failureCycles >= MAX_FAILURE_CYCLES) return interrupt(job);
      return pauseForRateLimit(job, account, event.rateReset);
    }
    await putJob(job, false);
    return;
  }

  // Fusion, et ordre de la liste (x.com charge les pages du plus récent au plus ancien).
  // Relecture depuis le haut en cours de scan (onglet rouvert, page rechargée) : les nouveaux
  // abonnés arriveraient au milieu de la liste, qui n'est plus dans l'ordre de x.com.
  if (!cursor && job.pages > 0 && job.kind !== 'quick') job.unordered = true;
  const order = (job.top ??= []);
  const state = liveOf(job);
  const readIds = (state.readIds ??= new Set(order));
  mergePage(job, readIds, page, Date.now());
  // Page reçue : une pause « chargement arrêté » est levée. La pause pour la limite de X, elle,
  // dure jusqu'à l'échéance (le défilement est arrêté) : une page arrivée en retard ne la lève pas.
  if (job.status === 'paused' && job.pausedReason !== 'rate-limit') {
    clearPause(job);
    await scanHooks().onStateChange();
  }
  const persist = shouldPersist(job, state.persistedAt, Date.now());
  if (persist) state.persistedAt = Date.now();
  await putJob(job, persist);

  // Contrôle léger : la première page (abonnés les plus récents) et le total suffisent.
  if (job.kind === 'quick') {
    if (job.totalSeen) await finish(job);
    // Total pas encore lu : la page profil le charge à coup sûr.
    else if (hasKnownHandle(account)) {
      await navigate(tabId, profileScanUrl(account));
    }
    return;
  }
  // Dernière requête autorisée avant la limite : pause tout de suite, sans attendre l'erreur suivante.
  if (!page.done && event.rateRemaining === 0) return pauseForRateLimit(job, account, event.rateReset);
  await sendVeil(job, account);

  // Scan lancé par un écart : arrêt dès que tous les départs annoncés sont trouvés. Jamais
  // après une perte de pages (`gap`) : les abonnés de ces pages passeraient pour des départs.
  if (job.target && !job.seeded && !job.gap && !job.unordered && !job.skipped) {
    if (state.previousOrder === undefined) {
      const snapshot = await loadSnapshot(job.accountId);
      state.previousOrder = snapshot?.ordered ? snapshot.ids : null;
      state.previousIndex = state.previousOrder ? orderIndex(state.previousOrder) : undefined;
    }
    const stop =
      state.previousOrder && state.previousIndex
        ? earlyStop(state.previousOrder, state.previousIndex, order, readIds, job.target)
        : undefined;
    if (stop) {
      // Marge : quelques pages de plus, au cas où l'écart sous-estime les départs réels.
      job.earlyStopPages = (job.earlyStopPages ?? 0) + 1;
      if (job.earlyStopPages > EARLY_STOP_MARGIN_PAGES) {
        job.earlyStop = stop;
        return finish(job);
      }
    }
  }
  if (page.done) {
    job.reachedEnd = true;
    await finish(job);
  }
}

function parseJson<T>(body: string, parse: (data: unknown) => T): T | undefined {
  try {
    return parse(JSON.parse(body));
  } catch {
    return undefined;
  }
}

/** Amène l'onglet sur la liste des abonnés et lance le défilement (sauf contrôle léger). */
async function routeTab(job: ScanJob, account: TrackedAccount, tabId: number, path?: string): Promise<void> {
  // Contrôle léger : première page déjà lue, l'onglet peut rester sur le profil (lecture du total).
  if (job.kind === 'quick' && job.pages > 0) return;
  if (!hasKnownHandle(account)) return; // le profil (`/i/user/<id>`) donnera le @handle
  if (path === undefined) {
    const tab = await chrome.tabs.get(tabId).catch(() => undefined);
    path = tab?.url ? new URL(tab.url).pathname : undefined;
  }
  if (!path) return;
  if (isFollowersPath(path, account.handle)) {
    if (job.kind === 'quick') return;
    // Limite de X : le défilement reste arrêté jusqu'à la reprise (chaque page serait refusée).
    if (job.status === 'paused' && job.pausedReason === 'rate-limit') return sendVeil(job, account);
    // Total annoncé par X inconnu (pas de profil reçu) : un passage par le profil pour le lire,
    // une seule fois, avant de faire défiler (sinon la progression n'a pas de total).
    if (!job.totalSeen && !job.expectedTotal && !job.totalLookupAt && job.pages === 0) {
      job.totalLookupAt = Date.now();
      await putJob(job, false);
      await navigate(tabId, profileScanUrl(account));
      // Sans réponse du profil, retour à la liste quand même (le scan avance sans total).
      setTimeout(() => void serial(() => returnFromLookup(job.accountId, tabId)), TOTAL_LOOKUP_MS);
      return;
    }
    await send(tabId, 'drive-start');
    await sendVeil(job, account);
  } else {
    // Sur le profil pour lire le total : on y reste le temps qu'il arrive (onProfile nous ramène).
    if (job.totalLookupAt && !job.totalSeen && Date.now() - job.totalLookupAt < TOTAL_LOOKUP_MS) return;
    // Autre page (dont `/i/user/<id>` une fois le @handle connu) : direction la liste des abonnés.
    await navigate(tabId, scanFollowersUrl(account));
  }
}

/** Fin de l'attente du total sur le profil : retour à la liste des abonnés. */
async function returnFromLookup(accountId: string, tabId: number): Promise<void> {
  const job = await getJob(accountId);
  const account = (await loadAccounts())[accountId];
  if (!job || !account || job.finishing || job.tabId !== tabId || job.totalSeen) return;
  await routeTab(job, account, tabId);
}

async function checkStall(job: ScanJob, account: TrackedAccount, visible: boolean): Promise<void> {
  const action = decideStall(job, visible, Date.now());
  if (action === 'lookup') {
    // x.com charge le profil par l'id du compte, qui donne le nouveau @handle.
    job.totalLookupAt = Date.now();
    await putJob(job, false);
    await navigate(job.tabId!, `${userIdUrl(account.id)}#${SCAN_MARKER}`);
  } else if (action === 'retry') {
    job.retriedAt = Date.now();
    // S'il est là, x.com a refusé une page (erreur ou limite non annoncée).
    const res = (await send(job.tabId!, 'retry')) as { clicked?: boolean } | undefined;
    if (res?.clicked) job.xError = true;
    await putJob(job, false);
  } else if (action === 'rate-limit') await pauseForRateLimit(job, account);
  else if (action === 'needs-focus') await pause(job, 'needs-focus');
  else if (action === 'finish') await finish(job);
}

/**
 * La session x.com est passée sur un autre compte : le scan en cours d'un autre compte ne peut
 * plus lire sa liste (X la servirait avec la session du nouveau compte). Il est mis en pause,
 * onglet fermé, et reprendra quand ce compte sera de nouveau connecté.
 */
export function suspendForeignScan(sessionAccountId: string): Promise<void> {
  return serial(async () => {
    const scanTab = await getScanTab();
    if (!scanTab || scanTab.accountId === sessionAccountId) return;
    const job = await getJob(scanTab.accountId);
    if (!job || job.finishing) return void (await localKv.remove(keys.scanTab));
    if (job.kind === 'quick') return discardQuick(job);
    await closeAndPause(job, 'account-switched');
  });
}

/** Rechargements d'affilée de l'onglet de scan sans que le script de page se mette en place. */
const MAX_REHOOKS = 3;
const rehooks = new Map<number, number>();

/**
 * Page de l'onglet de scan chargée : si le script de page n'y est pas (page rechargée sans le
 * fragment d'ouverture, par x.com ou à la restauration de Chrome), elle est rouverte avec. Le
 * service worker reconnaît l'onglet par son id : rien dans la page ne le désigne.
 */
export function handleTabLoaded(tabId: number, url: string | undefined): Promise<void> {
  return serial(async () => {
    const scanTab = await getScanTab();
    if (!scanTab || scanTab.tabId !== tabId) return;
    if (await isHooked(tabId)) return void rehooks.delete(tabId); // script de page en place
    const job = await getJob(scanTab.accountId);
    const account = (await loadAccounts())[scanTab.accountId];
    if (!job || !account || job.finishing || job.tabId !== tabId) return;
    const path = url ? new URL(url).pathname : undefined;
    if (path && isLoginPath(path)) {
      await closeAndPause(job, 'disconnected');
      return;
    }
    const tries = (rehooks.get(tabId) ?? 0) + 1;
    rehooks.set(tabId, tries);
    // Au-delà : le chien de garde arrêtera le scan (gardé comme incomplet).
    // Contrôle léger dont la première page est lue : il attend le total, sur le profil.
    const target = job.kind === 'quick' && job.pages > 0 && hasKnownHandle(account) ? profileScanUrl(account) : scanFollowersUrl(account);
    if (tries <= MAX_REHOOKS) await reopenWithHook(tabId, target);
  });
}

/** L'utilisateur a fermé l'onglet de scan. */
export function handleTabRemoved(tabId: number): Promise<void> {
  return serial(async () => {
    const scanTab = await getScanTab();
    if (!scanTab || scanTab.tabId !== tabId) return;
    await localKv.remove(keys.scanTab);
    if (isImporting()) return; // l'import arrête lui-même les scans
    const job = await getJob(scanTab.accountId);
    if (!job || job.finishing) return;
    if (job.kind === 'quick') return discardQuick({ ...job, tabId: undefined });
    // Scan interrompu (§ 4.3) : marqué incomplet, ses abonnés sont gardés pour la reprise.
    // Il est relancé à la vérification suivante, ou par « Continuer le scan ».
    await finalizeIncomplete(job);
  });
}

/** « Arrêter le scan » (scan bloqué) : arrêt immédiat, gardé comme incomplet. */
export function interruptScan(accountId: string): Promise<void> {
  return serial(async () => {
    const job = await getJob(accountId);
    if (job && !job.finishing) await interrupt(job);
  });
}

/**
 * Chien de garde : scan sans aucune page depuis `GIVE_UP_MS` (chargement bloqué, onglet caché qui
 * n'avance plus, page x.com déconnectée de l'extension…) hors limite de X annoncée : arrêté
 * d'office et gardé comme incomplet. Renvoie vrai si le scan a été arrêté.
 */
export function giveUpIfStalled(accountId: string): Promise<boolean> {
  return serial(async () => {
    const job = await getJob(accountId);
    if (!job || job.finishing) return false;
    if (!isStalled(job, Date.now())) return false;
    // Contrôle léger : son alarme de délai a pu se perdre (extension rechargée, service worker arrêté).
    await interrupt(job);
    return true;
  });
}

/** Annule le scan d'un compte (retrait du compte, import d'une sauvegarde). */
export function cancelScan(accountId: string): Promise<void> {
  return serial(async () => {
    const job = await getJob(accountId);
    if (job) await closeTab(job);
    await dropJob(accountId);
  });
}
