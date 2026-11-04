import { createSerialQueue } from '@/shared/utils/serial';
import { hasKnownHandle, loadAccounts, patchAccount } from '@/features/accounts/repository';
import { importEpoch, isImporting } from '@/features/backup/lock';
import { earlyStop } from '@/features/unfollow-detection/diff';
import { isRateLimited, parseFollowersPage, parseUserLookup, variablesOf, watchedOperation } from '@/features/x-api/parse';
import { readSession } from '@/features/x-api/session';
import { ALARM_QUICK_TIMEOUT_PREFIX } from '@/features/scheduler/alarms';
import { t } from '@/shared/i18n';
import { SCAN_MARKER, type SimpleTabCommand, type TabCommand, type TabEvent } from '@/shared/messaging/protocol';
import { localKv } from '@/shared/storage/kv';
import { keys } from '@/shared/storage/keys';
import type { ScanJob, ScanKind, ScanReason, TrackedAccount } from '@/shared/types';
import { clearJob, loadJob, loadPartial, loadSnapshot, saveJob, saveProgressOnly, type ScanProgress } from './repository';

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

export interface ScanHooks {
  onComplete: (job: ScanJob) => Promise<void>;
  /** Après la fermeture de l'onglet et l'effacement du scan (enchaînement d'un autre scan). */
  onFinished: (job: ScanJob) => Promise<void>;
  /** Scan complet interrompu (onglet fermé) : marqué incomplet (§ 4.3). */
  onInterrupted: (job: ScanJob) => Promise<void>;
  onStateChange: () => Promise<void>;
  scheduleResume: (accountId: string, at: number) => Promise<void>;
}

/** Sans nouvel abonné depuis ce délai, on considère le chargement bloqué. */
const STALL_MS = 20_000;
/** Onglet caché : délai plus long avant de demander à l'afficher (rendu simulé, plus lent). */
const HIDDEN_STALL_MS = 60_000;
/** Bloqué alors que l'onglet est visible, après un « Réessayer » : fin de liste probable. */
const END_MS = 60_000;
/** Contrôle léger : seule la première page compte. */
const QUICK_TOP_SIZE = 100;
/** La liste complète n'est écrite en stockage que toutes les N pages (l'état léger, à chaque page). */
const PERSIST_EVERY = 5;
/** Abonnés repris d'un scan incomplet : au-delà de cet âge, ils ne sont plus fiables (départs depuis). */
const SEED_MAX_AGE_MS = 24 * 3600_000;
/**
 * Arrêt anticipé : pages relues en plus une fois les départs annoncés trouvés. Le total de X
 * compte des comptes qu'il n'affiche pas : l'écart peut sous-estimer les départs réels.
 */
const EARLY_STOP_MARGIN_PAGES = 2;
/** Analyse de fin de scan abandonnée (service worker arrêté) : reprise après ce délai. */
const STALE_FINISH_MS = 2 * 60_000;

interface ScanTab {
  tabId: number;
  accountId: string;
}

let hooks: ScanHooks | undefined;
export const setScanHooks = (h: ScanHooks) => (hooks = h);

// Les événements d'onglet arrivent vite : on les traite un par un.
const tabEvents = createSerialQueue();
const serial = <T>(fn: () => Promise<T>): Promise<T> => tabEvents.run(fn);

// ---------------------------------------------------------------------------
// Scan en cours, gardé en mémoire (le service worker reste éveillé pendant un scan)
// ---------------------------------------------------------------------------

/**
 * État en mémoire d'un scan, par compte : le scan, les ids déjà lus et l'ancienne liste
 * ordonnée (arrêt anticipé, chargée une fois par scan). Un compte ne touche jamais à l'état
 * d'un autre (un contrôle léger abandonné ne peut pas évincer le scan d'un autre compte).
 */
interface Live {
  job: ScanJob;
  readIds?: Set<string>;
  previousOrder?: string[] | null;
}
const live = new Map<string, Live>();
/** Comptes dont l'analyse de fin de scan tourne dans ce service worker. */
const analyzing = new Set<string>();
/** Analyses en cours (toutes comptes confondus), attendues par l'import d'une sauvegarde. */
const inFlight = new Set<Promise<void>>();

/** Attend la fin des analyses déjà lancées (elles écrivent historique, instantané et compte). */
export async function settleAnalyses(): Promise<void> {
  await Promise.all([...inFlight]);
}

async function getJob(accountId: string): Promise<ScanJob | undefined> {
  const cached = live.get(accountId);
  if (cached) return cached.job;
  const job = await loadJob(accountId);
  if (!job) return undefined;
  if (!job.finishing && job.kind !== 'quick') {
    // La liste complète n'est écrite que toutes les N pages : si l'état léger en compte plus,
    // le service worker a été relancé et les pages intermédiaires sont perdues.
    const progress = await localKv.get<ScanProgress>(keys.scanProgress(accountId));
    if ((progress?.collected ?? 0) > (job.count ?? 0)) job.gap = true;
  }
  live.set(accountId, { job });
  return job;
}

/** Enregistre le scan : complet (liste comprise) si `full`, sinon seulement son état léger. */
async function putJob(job: ScanJob, full = true): Promise<void> {
  const cached = live.get(job.accountId);
  if (cached?.job === job) cached.job = job;
  else live.set(job.accountId, { job });
  await (full ? saveJob(job) : saveProgressOnly(job));
}

async function dropJob(accountId: string): Promise<void> {
  live.delete(accountId);
  await clearJob(accountId);
}

const clearPause = (job: ScanJob) => {
  job.status = 'running';
  job.pausedReason = undefined;
  job.resumeAt = undefined;
  job.error = undefined;
};

// ---------------------------------------------------------------------------
// Onglet de scan
// ---------------------------------------------------------------------------

const followersUrl = (account: TrackedAccount) =>
  hasKnownHandle(account)
    ? `https://x.com/${account.handle}/followers#${SCAN_MARKER}`
    : `https://x.com/i/user/${account.id}#${SCAN_MARKER}`;

const isFollowersPath = (path: string, handle: string) => path.toLowerCase() === `/${handle.toLowerCase()}/followers`;

/** x.com a redirigé l'onglet de scan vers la connexion : session absente (§ 4.6). */
const isLoginPath = (path: string) => /^\/(login|logout|i\/flow\/login|i\/flow\/signup)(\/|$)/.test(path);

/** Commande vers l'onglet de scan ; les commandes sans données s'écrivent par leur seul nom. */
async function send(tabId: number, command: TabCommand | SimpleTabCommand): Promise<unknown> {
  try {
    return await chrome.tabs.sendMessage(tabId, typeof command === 'string' ? { xgCmd: command } : command);
  } catch {
    return undefined; // contenu pas encore prêt : nouvel essai au prochain événement
  }
}

/** Met à jour l'overlay de l'onglet de scan (compteur, limite de X). */
async function sendVeil(job: ScanJob, account: TrackedAccount): Promise<void> {
  if (!job.visible || job.tabId === undefined) return;
  await send(job.tabId, {
    xgCmd: 'progress',
    collected: job.count ?? 0,
    seeded: job.seeded ?? 0,
    expected: job.expectedTotal,
    startedAt: job.startedAt,
    handle: hasKnownHandle(account) ? account.handle : undefined,
    state: job.status === 'paused' && job.pausedReason === 'rate-limit' ? 'rate-limit' : 'running',
    resumeAt: job.resumeAt,
  });
}

async function tabExists(tabId: number | undefined): Promise<boolean> {
  if (tabId === undefined) return false;
  return chrome.tabs.get(tabId).then(
    () => true,
    () => false,
  );
}

const getScanTab = () => localKv.get<ScanTab>(keys.scanTab);

async function openTab(job: ScanJob, account: TrackedAccount): Promise<void> {
  const url = followersUrl(account);
  // Scan complet comme contrôle léger (§ 4.6) : onglet épinglé, en arrière-plan. Il tient dans une
  // petite pastille à gauche, est difficile à fermer par erreur et se ferme tout seul à la fin.
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => undefined);
  const tab = await chrome.tabs.create({ url, pinned: true, active: false, windowId: win?.id });
  if (tab.id === undefined) throw new Error(t('common.scan.tabOpenFailed'));
  await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => undefined);
  job.tabId = tab.id;
  job.lastProgressAt = Date.now();
  job.retriedAt = undefined;
  await localKv.set({ [keys.scanTab]: { tabId: tab.id, accountId: job.accountId } satisfies ScanTab });
}

async function closeTab(job: ScanJob): Promise<void> {
  const tabId = job.tabId;
  job.tabId = undefined;
  await localKv.remove(keys.scanTab);
  if (tabId === undefined) return;
  await send(tabId, 'drive-stop'); // retire la protection « quitter la page ? »
  await chrome.tabs.remove(tabId).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// États du scan
// ---------------------------------------------------------------------------

async function pause(job: ScanJob, reason: ScanJob['pausedReason'], resumeAt?: number, error?: string) {
  // Limite de X : inutile de continuer à faire défiler (chaque essai serait refusé).
  if (reason === 'rate-limit' && job.tabId !== undefined) await send(job.tabId, 'drive-stop');
  job.status = 'paused';
  job.pausedReason = reason;
  job.resumeAt = resumeAt;
  job.error = error;
  job.updatedAt = Date.now();
  await putJob(job);
  if (resumeAt) await hooks?.scheduleResume(job.accountId, resumeAt);
  await hooks?.onStateChange();
}

/** Limite de requêtes de X : pause jusqu'à l'heure de reprise annoncée (au moins 30 s). */
async function pauseForRateLimit(job: ScanJob, account: TrackedAccount, rateReset?: number): Promise<void> {
  const resumeAt = Math.max(rateReset ?? Date.now() + 15 * 60_000, Date.now() + 30_000) + 5_000;
  await pause(job, 'rate-limit', resumeAt);
  await sendVeil(job, account);
}

/** Démarre un scan (ou reprend celui qui existe) pour le compte connecté. */
export async function startScan(
  account: TrackedAccount,
  kind: ScanKind,
  reason?: ScanReason,
  target?: number,
): Promise<void> {
  return serial(async () => {
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

/** Reprend un scan en pause ou dont l'onglet a disparu. */
export async function resumeScan(accountId: string): Promise<void> {
  return serial(async () => {
    const job = await getJob(accountId);
    const account = (await loadAccounts())[accountId];
    if (!job || !account || job.finishing) return;
    if (job.kind === 'quick') return discardQuick(job); // contrôle léger périmé : le prochain le remplacera
    if (job.pausedReason === 'rate-limit' && (await tabExists(job.tabId))) {
      // La limite est levée : on relance le chargement dans la page.
      clearPause(job);
      job.lastProgressAt = Date.now();
      job.retriedAt = Date.now();
      await putJob(job);
      await hooks?.onStateChange();
      await send(job.tabId!, 'retry');
      await send(job.tabId!, 'drive-start');
      await sendVeil(job, account);
      return;
    }
    await ensureTab(job, account);
  });
}

async function ensureTab(job: ScanJob, account: TrackedAccount): Promise<void> {
  const session = await readSession();
  if (!session) return pause(job, 'disconnected');
  if (session.accountId !== job.accountId) return pause(job, 'account-switched');
  if (!(await tabExists(job.tabId))) await openTab(job, account);
  clearPause(job);
  job.updatedAt = Date.now();
  await putJob(job);
  await hooks?.onStateChange();
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

async function discardQuick(job: ScanJob): Promise<void> {
  // Son délai d'expiration ne doit pas sonner plus tard sur un autre scan.
  await chrome.alarms.clear(`${ALARM_QUICK_TIMEOUT_PREFIX}${job.accountId}`);
  await closeTab(job);
  await dropJob(job.accountId);
  await hooks?.onStateChange();
}

/** Abandonne un contrôle léger qui n'a pas abouti (page trop lente, onglet suspendu). */
export function abortQuick(accountId: string): Promise<void> {
  return serial(async () => {
    const job = await getJob(accountId);
    if (job?.kind === 'quick' && !job.finishing) await discardQuick(job);
  });
}

// ---------------------------------------------------------------------------
// Événements des onglets x.com
// ---------------------------------------------------------------------------

export function handleTabEvent(event: TabEvent, tabId: number): Promise<void> {
  return serial(async () => {
    if (isImporting()) return; // données en cours de remplacement
    const scanTab = await getScanTab();
    if (!scanTab || scanTab.tabId !== tabId) return;
    const job = await getJob(scanTab.accountId);
    if (!job || job.tabId !== tabId || job.finishing) return;
    const account = (await loadAccounts())[job.accountId];
    if (!account) return;

    if (event.xgTab === 'ready' || event.xgTab === 'tick') {
      if (isLoginPath(event.path)) {
        await closeTab(job);
        await pause(job, 'disconnected');
        return;
      }
      await routeTab(job, account, tabId, event.path);
      if (event.xgTab === 'ready') await sendVeil(job, account);
      else await checkStall(job, event.visible);
      return;
    }

    // Seules les opérations GraphQL de x.com suivies par xGhost sont prises en compte.
    if (watchedOperation(event.url) !== event.op) return;
    if (event.op === 'Followers') await onFollowersPage(job, account, tabId, event);
    else await onProfile(job, account, tabId, event.body);
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
    job.expectedTotal = profile.followersCount;
    job.totalSeen = true;
  }
  await putJob(job, false);
  if (job.kind === 'quick' && job.totalSeen && job.pages > 0) return finish(job);
  await routeTab(job, { ...account, handle: profile.handle }, tabId);
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
  if (event.status >= 400) return; // x.com réessaiera ; le contrôle de blocage prend le relais
  const page = parseJson(event.body, (data) => parseFollowersPage(data, variablesOf(event.url).cursor));
  if (!page) return;

  // Fusion, et ordre de la liste (x.com charge les pages du plus récent au plus ancien).
  const order = (job.top ??= []);
  const state = live.get(job.accountId) ?? { job };
  live.set(job.accountId, state);
  const readIds = (state.readIds ??= new Set(order));
  let added = 0;
  for (const { id, ...profile } of page.users) {
    if (!(id in job.collected)) added++;
    job.collected[id] = profile;
    if (!readIds.has(id) && !(job.kind === 'quick' && order.length >= QUICK_TOP_SIZE)) {
      order.push(id);
      readIds.add(id);
    }
  }
  job.count = (job.count ?? 0) + added;
  job.pages++;
  job.updatedAt = Date.now();
  // Toute page reçue est un progrès, même sans nouvel abonné (reprise qui relit la zone déjà lue).
  job.lastProgressAt = Date.now();
  // Page reçue : une pause « chargement arrêté » est levée. La pause pour la limite de X, elle,
  // dure jusqu'à l'échéance (le défilement est arrêté) : une page arrivée en retard ne la lève pas.
  if (job.status === 'paused' && job.pausedReason !== 'rate-limit') {
    clearPause(job);
    await hooks?.onStateChange();
  }
  await putJob(job, job.kind === 'quick' || job.pages % PERSIST_EVERY === 0);

  // Contrôle léger : la première page (abonnés les plus récents) et le total suffisent.
  if (job.kind === 'quick') {
    if (job.totalSeen) await finish(job);
    // Total pas encore lu : la page profil le charge à coup sûr.
    else if (hasKnownHandle(account)) {
      await chrome.tabs.update(tabId, { url: `https://x.com/${account.handle}` }).catch(() => undefined);
    }
    return;
  }
  // Dernière requête autorisée avant la limite : pause tout de suite, sans attendre l'erreur suivante.
  if (!page.done && event.rateRemaining === 0) return pauseForRateLimit(job, account, event.rateReset);
  await sendVeil(job, account);

  // Scan lancé par un écart : arrêt dès que tous les départs annoncés sont trouvés. Jamais
  // après une perte de pages (`gap`) : les abonnés de ces pages passeraient pour des départs.
  if (job.target && !job.seeded && !job.gap) {
    if (state.previousOrder === undefined) {
      const snapshot = await loadSnapshot(job.accountId);
      state.previousOrder = snapshot?.ordered ? snapshot.ids : null;
    }
    const stop = state.previousOrder ? earlyStop(state.previousOrder, readIds, job.target) : undefined;
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
    await send(tabId, 'drive-start');
    await sendVeil(job, account);
  } else if (!path.startsWith('/i/user/')) {
    await chrome.tabs.update(tabId, { url: followersUrl(account) }).catch(() => undefined);
  }
}

async function checkStall(job: ScanJob, visible: boolean): Promise<void> {
  if (job.status === 'paused' && job.pausedReason === 'rate-limit') return;
  const idle = Date.now() - (job.lastProgressAt ?? job.startedAt);
  if (idle < STALL_MS) return;

  if (!visible) {
    // Le rendu simulé fait normalement avancer la page cachée ; sinon, on demande à l'afficher.
    if (idle >= HIDDEN_STALL_MS && job.pausedReason !== 'needs-focus') await pause(job, 'needs-focus');
    return;
  }
  if (!job.retriedAt || job.retriedAt < (job.lastProgressAt ?? 0)) {
    job.retriedAt = Date.now();
    await putJob(job, false);
    await send(job.tabId!, 'retry');
    return;
  }
  // Toujours rien, onglet visible, après un nouvel essai : on considère la liste terminée.
  // Une liste trop courte est marquée incomplète (§ 4.7) et pourra être continuée.
  if (idle >= END_MS) await finish(job);
}

async function finish(job: ScanJob): Promise<void> {
  if (job.finishing) return;
  job.finishing = true;
  job.updatedAt = Date.now();
  await putJob(job);
  // Fin (§ 4.6) : l'onglet se ferme immédiatement, l'analyse se fait ensuite.
  await closeTab(job);
  // `finish` tourne dans la file des événements : l'analyse en sort pour ne pas la bloquer.
  void analyze(job);
}

/**
 * Analyse d'un scan terminé (comparaison, événements, instantané), puis effacement du scan.
 * Un échec de l'analyse met le scan en pause pour un nouvel essai ; ce qui suit l'effacement
 * (statut, enchaînement) ne fait que journaliser ses erreurs, sans ressusciter le scan.
 */
function analyze(job: ScanJob): Promise<void> {
  if (analyzing.has(job.accountId)) return Promise.resolve();
  const run = runAnalysis(job);
  inFlight.add(run);
  void run.finally(() => inFlight.delete(run));
  return run;
}

async function runAnalysis(job: ScanJob): Promise<void> {
  analyzing.add(job.accountId);
  const epoch = importEpoch();
  try {
    try {
      // Import d'une sauvegarde pendant le scan : ses données font foi, l'analyse est abandonnée.
      if (!isImporting() && epoch === importEpoch()) await hooks?.onComplete(job);
      await dropJob(job.accountId);
    } catch (err) {
      console.error(t('common.log.scanEnd'), err);
      if (epoch !== importEpoch()) return;
      job.finishing = false;
      await serial(() => pause(job, 'error', Date.now() + 15 * 60_000, err instanceof Error ? err.message : String(err)));
      return;
    }
    await hooks?.onStateChange();
    if (epoch === importEpoch()) await hooks?.onFinished(job);
  } catch (err) {
    console.error(t('common.log.scanEnd'), err);
  } finally {
    analyzing.delete(job.accountId);
  }
}

/**
 * Scan resté « en analyse » alors qu'aucune analyse ne tourne : le service worker a été arrêté
 * pendant l'analyse. Elle est relancée (elle ne recrée ni départ ni arrivée déjà enregistrés).
 * Renvoie vrai si le scan est en fin d'analyse (récupéré ou en cours).
 */
export function recoverFinishing(accountId: string): Promise<boolean> {
  return serial(async () => {
    const job = await getJob(accountId);
    if (!job?.finishing) return false;
    const stale = !analyzing.has(accountId) && Date.now() - job.updatedAt > STALE_FINISH_MS;
    if (stale) void analyze(job);
    return true;
  });
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
    await closeTab(job);
    await pause(job, 'account-switched');
  });
}

/** L'utilisateur a fermé l'onglet de scan. */
export function handleTabRemoved(tabId: number): Promise<void> {
  return serial(async () => {
    const scanTab = await getScanTab();
    if (!scanTab || scanTab.tabId !== tabId) return;
    await localKv.remove(keys.scanTab);
    const job = await getJob(scanTab.accountId);
    if (!job || job.finishing) return;
    if (job.kind === 'quick') return discardQuick({ ...job, tabId: undefined });
    // Scan interrompu (§ 4.3) : marqué incomplet, ses abonnés sont gardés pour la reprise.
    // Il est relancé à la vérification suivante, ou par « Continuer le scan ».
    await hooks?.onInterrupted(job);
    await dropJob(job.accountId);
    await hooks?.onStateChange();
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
