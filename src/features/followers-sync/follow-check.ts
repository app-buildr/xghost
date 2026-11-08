import { followCheckAlarm } from '@/features/scheduler/alarms';
import { isRateLimited, parseUserLookup, variablesOf, watchedOperation } from '@/features/x-api/parse';
import { SCAN_MARKER, type TabEvent } from '@/shared/messaging/protocol';
import { isImporting } from '@/shared/storage/import-lock';
import { keys } from '@/shared/storage/keys';
import { localKv } from '@/shared/storage/kv';
import type { FollowCheck, FollowCheckResult, TrackedAccount } from '@/shared/types';
import { HOUR, MINUTE, SECOND } from '@/shared/utils/time';
import { profileUrl, userIdUrl } from '@/shared/x-urls';
import { loadFollowChecks, updateFollowChecks } from './repository';
import { scanHooks, serial } from './scan-context';
import { getScanTab, isHooked, navigate, registerScanTab, type ScanTab } from './scan-tab';

/**
 * Vérification du follow back des départs : pour chaque départ détecté, la fiche du compte parti
 * est ouverte dans l'onglet de scan, et la réponse que x.com reçoit dit si l'utilisateur le suit
 * (le cache des profils, lu dans la liste des abonnés, peut dater du scan de référence).
 *
 * Comme pour les scans, xGhost ne fait aucune requête : il lit la réponse du profil chargée par
 * x.com. Les départs passent par petites passes espacées ; ce qui reste attend la passe suivante.
 * Un scan est prioritaire : il ferme l'onglet de vérification, qui reprendra après lui.
 *
 * Toutes les fonctions de ce module tournent dans la file des événements (`serial`).
 */

/** Profils ouverts au plus par passe. */
const FOLLOW_CHECKS_PER_PASS = 15;
/** Attente de la réponse du profil, après quoi le départ est retenté à une passe suivante. */
const FOLLOW_CHECK_TIMEOUT_MS = 25 * SECOND;
/** Pause entre deux profils (tirée au hasard dans cet intervalle). */
const GAP_MIN_MS = 4 * SECOND;
const GAP_MAX_MS = 8 * SECOND;
/** Délai avant la passe suivante, s'il reste des départs à vérifier. */
const FOLLOW_CHECK_NEXT_PASS_MS = 15 * MINUTE;
/** Passe interrompue (onglet fermé, session perdue, x.com muet) : nouvel essai après ce délai. */
const RETRY_LATER_MS = 30 * MINUTE;
/** Filet si le service worker s'arrête en pleine passe : l'alarme la relance. */
const SAFETY_MS = 10 * MINUTE;
/** Essais sans réponse avant d'abandonner un départ (il garde la valeur enregistrée). */
const MAX_ATTEMPTS = 3;
/** Profils sans réponse d'affilée : x.com ne répond plus, la passe s'arrête. */
const MAX_SILENT = 2;

interface Run {
  accountId: string;
  tabId?: number;
  current?: FollowCheck;
  /** Profil courant rouvert avec le script de page (page rechargée sans lui). */
  rehooked?: boolean;
  /** Profils traités dans cette passe (réponse ou abandon). */
  handled: number;
  /** Départs déjà ouverts dans cette passe. */
  tried: Set<string>;
  silent: number;
  results: FollowCheckResult[];
  timer?: ReturnType<typeof setTimeout>;
  /** Change à chaque étape : un minuteur d'une étape passée ne fait plus rien. */
  step: number;
}

let run: Run | undefined;

const isLoginPath = (path: string) => /^\/(login|logout|i\/flow\/login|i\/flow\/signup)(\/|$)/.test(path);
const checkUrl = (item: FollowCheck) => `${userIdUrl(item.profileId)}#${SCAN_MARKER}`;
const checkTabOf = (item: FollowCheck) => ({ purpose: 'follow-check' as const, profileId: item.profileId, handle: item.handle });

/**
 * Démarre une passe pour le compte (le compte connecté, sans scan en cours : vérifié par l'appelant).
 * `busy` : l'onglet de scan est occupé ; `empty` : rien à vérifier.
 */
export async function beginFollowCheck(account: TrackedAccount): Promise<'started' | 'busy' | 'empty'> {
  if (run) return 'busy';
  const scanTab = await getScanTab();
  if (scanTab) {
    // Onglet de vérification resté d'une passe interrompue (service worker arrêté) : fermé.
    if (scanTab.purpose !== 'follow-check') return 'busy';
    await discardTab(scanTab);
  }
  const [first] = await loadFollowChecks(account.id);
  if (!first) return 'empty';
  const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] }).catch(() => undefined);
  const tab = await chrome.tabs.create({ url: checkUrl(first), pinned: true, active: false, windowId: win?.id });
  if (tab.id === undefined) return 'busy';
  await chrome.tabs.update(tab.id, { autoDiscardable: false }).catch(() => undefined);
  await registerScanTab(tab.id, account.id, checkTabOf(first));
  await chrome.alarms.create(followCheckAlarm(account.id), { when: Date.now() + SAFETY_MS });
  run = { accountId: account.id, tabId: tab.id, current: first, handled: 0, tried: new Set([first.eventId]), silent: 0, results: [], step: 0 };
  armTimeout(run);
  return 'started';
}

/** Événement de l'onglet de vérification (`scanTab.purpose === 'follow-check'`). */
export async function onFollowCheckEvent(event: TabEvent, tabId: number, scanTab: ScanTab): Promise<void> {
  // Onglet d'une passe perdue (service worker relancé) : rien ne le pilote plus, il est fermé.
  if (!run || run.tabId !== tabId) return discardTab(scanTab);
  if (event.xgTab === 'ready' || event.xgTab === 'tick') {
    if (isLoginPath(event.path)) await end(Date.now() + RETRY_LATER_MS);
    return;
  }
  const current = run.current;
  if (!current || event.op === 'Followers' || watchedOperation(event.url) !== event.op) return;
  if (isRateLimited(event.status, event.body)) return end(retryAt(event.rateReset));
  const lookup = parseJson(event.body);
  if (!lookup) return;
  let result: FollowCheckResult | undefined;
  if (lookup.profile?.id === current.profileId) {
    const { id: _id, followersCount: _count, ...profile } = lookup.profile;
    result = { eventId: current.eventId, profileId: current.profileId, following: lookup.following, profile };
  } else if (lookup.status !== 'active' && event.op === 'UserByRestId' && variablesOf(event.url).userId === current.profileId) {
    // Compte suspendu ou supprimé : rien à lire sur son profil, le départ garde sa valeur.
    result = { eventId: current.eventId, profileId: current.profileId };
  }
  if (!result) return;
  run.results.push(result);
  run.silent = 0;
  await settle(run, current, true);
  // Dernière requête autorisée par X : la suite attendra la levée de la limite.
  if (run && event.rateRemaining === 0) return end(retryAt(event.rateReset));
  if (run) await next(run);
}

/** Page de l'onglet de vérification chargée : rouverte une fois avec le script de page s'il manque. */
export async function onFollowCheckLoaded(tabId: number, scanTab: ScanTab): Promise<void> {
  if (!run || run.tabId !== tabId) return discardTab(scanTab);
  if (!run.current || run.rehooked || (await isHooked(tabId))) return;
  run.rehooked = true;
  const url = checkUrl(run.current);
  const current = await chrome.tabs.get(tabId).then((tab) => tab.url, () => undefined);
  await navigate(tabId, url);
  // Même page : seul le fragment changerait, sans recharger ni réinstaller le script de page.
  if (current && new URL(current).pathname === new URL(url).pathname) await chrome.tabs.reload(tabId).catch(() => undefined);
}

/** L'utilisateur a fermé l'onglet de vérification : passe arrêtée, reprise plus tard. */
export async function onFollowCheckTabRemoved(tabId: number): Promise<void> {
  await localKv.remove(keys.scanTab);
  if (!run || run.tabId !== tabId) return;
  run.tabId = undefined;
  await end(Date.now() + RETRY_LATER_MS);
}

/**
 * Arrête la passe (un scan prend l'onglet, autre compte connecté) : ce qui a été lu est appliqué,
 * le reste attend la passe suivante. Sans passe en cours, ferme l'onglet resté ouvert.
 */
export async function stopFollowCheck(scanTab?: ScanTab): Promise<void> {
  if (run) return end(Date.now() + FOLLOW_CHECK_NEXT_PASS_MS);
  if (scanTab?.purpose === 'follow-check') await discardTab(scanTab);
}

/** Abandonne la passe d'un compte sans rien appliquer (retrait du compte, import d'une sauvegarde). */
export async function abandonFollowCheck(accountId: string): Promise<void> {
  const scanTab = await getScanTab();
  if (run?.accountId === accountId) {
    const tabId = run.tabId;
    clearTimeout(run.timer);
    run = undefined;
    if (tabId !== undefined) await chrome.tabs.remove(tabId).catch(() => undefined);
  }
  if (scanTab?.purpose === 'follow-check' && scanTab.accountId === accountId) await discardTab(scanTab);
}

/**
 * Onglet de vérification resté d'avant un redémarrage de Chrome (son id a changé). Sont fermés les
 * onglets épinglés et en arrière-plan sur le profil alors ouvert : par son id (`/i/user/<id>`, que
 * l'on n'épingle pas soi-même), ou par son @handle si x.com a redirigé la page. L'onglet affiché
 * n'est jamais fermé : l'utilisateur le regarde, c'est peut-être le sien.
 */
export async function sweepRestoredFollowCheckTab(scanTab: ScanTab): Promise<void> {
  const url = [
    ...(scanTab.profileId ? [userIdUrl(scanTab.profileId)] : []),
    ...(scanTab.handle ? [profileUrl(scanTab.handle)] : []),
  ];
  if (url.length === 0) return;
  const pinned = await chrome.tabs.query({ pinned: true, active: false, url }).catch(() => []);
  await Promise.all(pinned.map((tab) => (tab.id === undefined ? undefined : chrome.tabs.remove(tab.id).catch(() => undefined))));
}

// ---------------------------------------------------------------------------
// Étapes d'une passe
// ---------------------------------------------------------------------------

function armTimeout(r: Run) {
  clearTimeout(r.timer);
  const step = ++r.step;
  r.timer = setTimeout(() => void serial(() => onTimeout(step)), FOLLOW_CHECK_TIMEOUT_MS);
}

/** Profil sans réponse : le départ est retenté plus tard (abandonné après quelques essais). */
async function onTimeout(step: number): Promise<void> {
  if (!run || run.step !== step || !run.current) return;
  const current = run.current;
  run.silent += 1;
  await settle(run, current, false);
  if (!run) return;
  if (run.silent >= MAX_SILENT) return end(Date.now() + RETRY_LATER_MS);
  await next(run);
}

/** Profil traité : retiré de la file s'il a répondu, ou après trop d'essais. */
async function settle(r: Run, item: FollowCheck, answered: boolean): Promise<void> {
  r.current = undefined;
  r.rehooked = undefined;
  r.handled += 1;
  clearTimeout(r.timer);
  await updateFollowChecks(r.accountId, (queue) =>
    queue.flatMap((q) => {
      if (q.eventId !== item.eventId) return [q];
      const attempts = (q.attempts ?? 0) + 1;
      return answered || attempts >= MAX_ATTEMPTS ? [] : [{ ...q, attempts }];
    }),
  );
}

/** Profil suivant après une courte pause, ou fin de la passe. */
async function next(r: Run): Promise<void> {
  // Un départ resté sans réponse dans cette passe attend la suivante.
  const candidate = (await loadFollowChecks(r.accountId)).find((q) => !r.tried.has(q.eventId));
  if (!candidate || r.handled >= FOLLOW_CHECKS_PER_PASS) return end();
  const step = ++r.step;
  clearTimeout(r.timer);
  const gap = GAP_MIN_MS + Math.random() * (GAP_MAX_MS - GAP_MIN_MS);
  r.timer = setTimeout(() => void serial(() => open(step, candidate)), gap);
}

async function open(step: number, item: FollowCheck): Promise<void> {
  if (!run || run.step !== step || run.tabId === undefined) return;
  run.current = item;
  run.tried.add(item.eventId);
  await registerScanTab(run.tabId, run.accountId, checkTabOf(item));
  armTimeout(run);
  await navigate(run.tabId, checkUrl(item));
}

/** Fin de la passe : onglet fermé, résultats appliqués, passe suivante programmée s'il reste des départs. */
async function end(retry?: number): Promise<void> {
  if (!run) return;
  const { accountId, tabId, results } = run;
  clearTimeout(run.timer);
  run = undefined;
  const scanTab = await getScanTab();
  if (scanTab?.purpose === 'follow-check' && scanTab.tabId === tabId) await localKv.remove(keys.scanTab);
  if (tabId !== undefined) await chrome.tabs.remove(tabId).catch(() => undefined);
  // Import d'une sauvegarde en cours : ses données font foi, rien n'est appliqué.
  if (isImporting()) return;
  const remaining = (await loadFollowChecks(accountId)).length;
  const nextAt = remaining ? (retry ?? Date.now() + FOLLOW_CHECK_NEXT_PASS_MS) : undefined;
  await scanHooks().onFollowCheckDone(accountId, results, nextAt);
}

async function discardTab(scanTab: ScanTab): Promise<void> {
  if ((await getScanTab())?.tabId === scanTab.tabId) await localKv.remove(keys.scanTab);
  await chrome.tabs.remove(scanTab.tabId).catch(() => undefined);
}

/** Limite de X : reprise à l'heure annoncée (bornée), sinon plus tard. */
function retryAt(rateReset?: number): number {
  const now = Date.now();
  if (rateReset === undefined || !Number.isFinite(rateReset)) return now + FOLLOW_CHECK_NEXT_PASS_MS;
  return Math.min(Math.max(rateReset, now + MINUTE), now + HOUR);
}

function parseJson(body: string) {
  try {
    return parseUserLookup(JSON.parse(body));
  } catch {
    return undefined;
  }
}
