import { createSerialQueue } from '@/shared/utils/serial';
import {
  ALARM_CHECK,
  ALARM_QUICK_TIMEOUT_PREFIX,
  ALARM_RECHECK_PREFIX,
  ALARM_RESUME_PREFIX,
  ALARM_RETRY_PREFIX,
  ALARM_WATCHDOG,
} from './alarms';
import { exceedsFollowerLimit } from '@/features/accounts/limit';
import { isOnboarded } from '@/features/accounts/model';
import {
  getSelectedAccountId,
  loadAccounts,
  patchAccount,
  setSelectedAccountId,
  updateAccounts,
} from '@/features/accounts/repository';
import { refreshBadge } from '@/features/alerts/badge';
import { importEpoch, isImporting } from '@/shared/storage/import-lock';
import { notifyAccountAdded } from '@/features/alerts/notifications';
import { clearPartial, loadJob, loadSnapshot } from '@/features/followers-sync/repository';
import {
  abortQuick,
  cancelScan,
  giveUpIfStalled,
  interruptScan,
  isScanActive,
  settleAnalyses,
  recoverFinishing,
  resumeScan,
  setScanHooks,
  startScan,
  suspendForeignScan,
} from '@/features/followers-sync/scan-engine';
import { loadSettings } from '@/features/settings/repository';
import { applyQuickCheck, applyScan, saveIncomplete } from '@/features/unfollow-detection/apply';
import { readSession } from '@/features/x-api/session';
import { localKv } from '@/shared/storage/kv';
import { keys } from '@/shared/storage/keys';
import type { GlobalStatus, ScanKind, ScanReason, TrackedAccount } from '@/shared/types';
import { HOUR, MINUTE, SECOND } from '@/shared/utils/time';
import { loadStatus, saveStatus } from './status';

/**
 * Orchestration : alarmes, détection automatique des comptes (§ 4.4),
 * vérifications périodiques (§ 4.2), reprises et nouvelles tentatives.
 */

/** Un scan complet de contrôle tous les N contrôles légers. */
const SAFETY_EVERY = 10;
/** Durée maximale d'un contrôle léger (chargement de la page et de la première liste). */
const QUICK_TIMEOUT_MS = 90 * SECOND;
/** Alarme d'un autre compte que celui connecté sur x.com : reportée de ce délai. */
const OTHER_ACCOUNT_DELAY_MS = 30 * MINUTE;
/** Report d'une vérification refusée parce qu'autre chose est en cours. */
const BUSY_DELAY_MS = 5 * MINUTE;
/** Attente maximale entre deux reports d'une même vérification. */
const MAX_DEFER_MS = 12 * HOUR;
/** Reports successifs par alarme (remis à zéro quand la vérification démarre). */
const deferrals = new Map<string, number>();
/** Scan de référence automatique qui n'aboutit pas : attente avant le suivant, doublée à chaque essai. */
const BASELINE_RETRY_MS = 15 * MINUTE;
const BASELINE_RETRY_MAX_MS = 12 * HOUR;

/**
 * Origine d'une vérification :
 * - `user` : « Vérifier maintenant » → contrôle léger (abonnés les plus récents + total) ;
 * - `user-full` : « Scan complet », « Continuer le scan » → scan complet ;
 * - `schedule` : alarme périodique → contrôle léger, ou scan complet si le dernier est incomplet ;
 * - `auto` : reprise, nouveau compte, ou départs repérés par le contrôle léger → idem `schedule` ;
 * - `followup` : le contrôle léger a vu le total baisser → scan complet immédiat ;
 * - `retry` : nouvel essai d'un scan complet au résultat suspect → scan complet.
 *
 * Tout scan complet a lieu dans l'onglet x.com épinglé en arrière-plan (§ 4.6).
 */
export type CheckOrigin = 'user' | 'user-full' | 'schedule' | 'auto' | 'followup' | 'retry';

setScanHooks({
  async onComplete(job) {
    if (job.kind === 'quick') {
      await chrome.alarms.clear(`${ALARM_QUICK_TIMEOUT_PREFIX}${job.accountId}`);
      const outcome = await applyQuickCheck(job);
      if (outcome.kind === 'recheck') {
        await chrome.alarms.create(`${ALARM_RECHECK_PREFIX}${job.accountId}`, { when: outcome.at });
      }
      return;
    }
    const outcome = await applyScan(job);
    if (outcome.kind === 'retry') {
      await chrome.alarms.create(`${ALARM_RETRY_PREFIX}${job.accountId}`, { when: outcome.at });
    }
  },
  async onFinished(job) {
    // Le contrôle léger a repéré des départs : le scan complet les identifie aussitôt
    // (si ce compte est toujours celui connecté ; sinon au prochain contrôle).
    if (job.kind !== 'quick') return;
    const account = (await loadAccounts())[job.accountId];
    if (account?.pending) await triggerCheck('followup', job.accountId);
  },
  async onInterrupted(job) {
    await saveIncomplete(job);
  },
  async onStateChange() {
    await updateStatus({ badge: true });
  },
  async scheduleResume(accountId, at) {
    await chrome.alarms.create(`${ALARM_RESUME_PREFIX}${accountId}`, { when: at });
  },
  async onFollowerLimit(job, count) {
    await markFollowerLimit(job.accountId, count);
  },
  async onFollowerLimitCleared(accountId) {
    await patchAccount(accountId, { limit: undefined });
  },
});

/**
 * Limite d'abonnés dépassée (§ 4.9) : le compte est marqué, et tout ce qui relancerait un scan
 * (départs en attente, nouvel essai, revérification, reprise) est effacé. La date du premier
 * dépassement est gardée ; le total, lui, est mis à jour.
 */
async function markFollowerLimit(accountId: string, count: number): Promise<void> {
  await updateAccounts((all) => {
    const a = all[accountId];
    if (!a) return;
    all[accountId] = {
      ...a,
      followersCount: count,
      limit: { count, at: a.limit?.at ?? Date.now() },
      pending: undefined,
      baselineRetry: undefined,
    };
  });
  await clearPartial(accountId);
  await Promise.all(
    [ALARM_RETRY_PREFIX, ALARM_RECHECK_PREFIX, ALARM_RESUME_PREFIX, ALARM_QUICK_TIMEOUT_PREFIX].map((prefix) =>
      chrome.alarms.clear(`${prefix}${accountId}`),
    ),
  );
}

export async function setupAlarms(): Promise<void> {
  const { frequencyHours } = await loadSettings();
  const existing = await chrome.alarms.get(ALARM_CHECK);
  if (frequencyHours === 0) {
    // Manuel uniquement : aucune vérification programmée, l'utilisateur lance lui-même les contrôles.
    if (existing) await chrome.alarms.clear(ALARM_CHECK);
  } else if (existing?.periodInMinutes !== frequencyHours * 60) {
    await chrome.alarms.create(ALARM_CHECK, { periodInMinutes: frequencyHours * 60 });
  }
  if (!(await chrome.alarms.get(ALARM_WATCHDOG))) {
    await chrome.alarms.create(ALARM_WATCHDOG, { periodInMinutes: 1 });
  }
}

/**
 * État global affiché par l'icône et les interfaces. Écrit seulement s'il change (le chien de
 * garde l'appelle chaque minute) ; l'icône est recalculée à ce moment-là, ou si `badge` le
 * demande (état d'un scan changé).
 */
export async function updateStatus({ badge = false }: { badge?: boolean } = {}): Promise<GlobalStatus> {
  const session = await readSession();
  const previous = await loadStatus();
  const status: GlobalStatus = {
    session: session ? 'ok' : 'disconnected',
    activeAccountId: session?.accountId,
    updatedAt: Date.now(),
  };
  const changed = previous?.session !== status.session || previous.activeAccountId !== status.activeAccountId;
  if (changed) await saveStatus(status);
  if (changed || badge) await refreshBadge();
  return changed ? status : previous!;
}

/**
 * Enregistre le compte connecté s'il est inconnu (ajout automatique, § 4.4).
 * Le @handle et le nombre d'abonnés sont complétés pendant le scan, à partir des
 * réponses lues dans la page x.com.
 */
export function ensureActiveAccount(explicit = false): Promise<TrackedAccount | undefined> {
  // Appelé de plusieurs endroits à la fois au réveil : un seul ajout (et une seule notification).
  return accountQueue.run(() => addSessionAccount(explicit));
}
const accountQueue = createSerialQueue();

/**
 * `explicit` : demande de l'utilisateur (« Vérifier maintenant », onboarding). Un compte retiré
 * alors qu'il était connecté n'est ré-ajouté que sur demande, ou après une reconnexion.
 */
async function addSessionAccount(explicit: boolean): Promise<TrackedAccount | undefined> {
  const session = await readSession();
  if (!session) return undefined;
  const accounts = await loadAccounts();
  const known = accounts[session.accountId];
  if (known) return known;
  if ((await localKv.get<string>(keys.dismissed)) === session.accountId) {
    if (!explicit) return undefined;
    await localKv.remove(keys.dismissed);
  }

  const isFirst = Object.keys(accounts).length === 0;
  const account: TrackedAccount = {
    id: session.accountId,
    handle: session.accountId,
    addedAt: Date.now(),
    mutualsOnly: false,
  };
  await updateAccounts((all) => {
    all[account.id] = all[account.id] ?? account;
  });
  if (!(await getSelectedAccountId()) || isFirst) await setSelectedAccountId(account.id);
  // Le premier compte est présenté par l'onboarding ; les suivants par une notification discrète.
  if (!isFirst) await notifyAccountAdded().catch(() => undefined);
  return account;
}

/**
 * Lance la vérification du compte connecté (voir `CheckOrigin`). `accountId` : vérification
 * propre à un compte (alarme, enchaînement), sans effet si ce n'est pas le compte connecté.
 */
export async function triggerCheck(
  origin: CheckOrigin,
  accountId?: string,
): Promise<{ started: boolean; reason?: string }> {
  if (isImporting()) return { started: false, reason: 'importing' };
  const account = await ensureActiveAccount(origin === 'user' || origin === 'user-full');
  if (!account) {
    await updateStatus();
    return { started: false, reason: 'disconnected' };
  }
  if (accountId && accountId !== account.id) return { started: false, reason: 'account-switched' };
  const user = origin === 'user' || origin === 'user-full';

  const existing = await loadJob(account.id);

  // Limite d'abonnés (§ 4.9), d'après le dernier total connu (le moteur la teste aussi dès qu'il
  // lit le profil). Compte jamais synchronisé : rien n'est lancé. Compte suivi : seules les
  // vérifications automatiques continuent, en contrôle léger (total relu, aucun défilement) ;
  // si le total repasse sous la limite, le moteur lève le blocage et tout reprend.
  if (account.limit || exceedsFollowerLimit(account, account.followersCount)) {
    if (!account.limit) await markFollowerLimit(account.id, account.followersCount!);
    if (existing && existing.kind !== 'quick' && !existing.finishing) await cancelScan(account.id);
    const probe = !!account.baselineAt && (origin === 'schedule' || origin === 'auto');
    if (!probe) return { started: false, reason: 'follower-limit' };
    if (existing?.kind === 'quick' || existing?.finishing) return { started: false, reason: 'already-running' };
    await startScan(account, 'quick', 'quick');
    await chrome.alarms.create(`${ALARM_QUICK_TIMEOUT_PREFIX}${account.id}`, { when: Date.now() + QUICK_TIMEOUT_MS });
    return { started: true };
  }
  // Analyse de fin de scan en cours (ou interrompue par l'arrêt du service worker, reprise ici).
  if (existing?.finishing) {
    await recoverFinishing(account.id);
    return { started: false, reason: 'already-running' };
  }
  if (existing?.kind === 'quick') {
    if (origin !== 'user-full') return { started: false, reason: 'already-running' };
    await abortQuick(account.id); // l'utilisateur veut un scan complet
  } else if (existing) {
    if (await isScanActive(account.id)) return { started: false, reason: 'already-running' };
    // Une pause datée (limite de requêtes) n'est levée qu'à l'échéance, sauf demande de l'utilisateur.
    if (!user && existing.resumeAt && existing.resumeAt > Date.now()) {
      return { started: false, reason: existing.pausedReason };
    }
    await resumeScan(account.id);
    return { started: true };
  }

  const snapshot = await loadSnapshot(account.id);
  // Premier démarrage : rien ne part vers X tant que l'utilisateur n'a pas choisi entre une
  // nouvelle synchronisation et l'import d'une sauvegarde (§ 3.3).
  if (!user && !isOnboarded(await loadAccounts())) {
    return { started: false, reason: 'awaiting-choice' };
  }
  // Dernier scan incomplet : on le continue (union) au lieu d'un simple contrôle léger (§ 4.7).
  const incomplete = account.lastScan ? !account.lastScan.complete : false;
  // Liste classée du plus récent au plus ancien : le contrôle léger suffit tant que le total
  // ne baisse pas ; sinon il enchaîne lui-même un scan complet (`followup`).
  // Scan de contrôle : après SAFETY_EVERY contrôles légers sans scan relu de bout en bout
  // (un scan complet manuel remet le compteur à zéro), pour rattraper ce qui aurait échappé.
  const safety = origin !== 'user' && (account.quickSinceFull ?? 0) >= SAFETY_EVERY;
  const full = origin === 'user-full' || origin === 'followup' || origin === 'retry' || incomplete || safety;
  // Pas de référence (instantané, ou compte sans date de référence) : scan de référence.
  const kind: ScanKind = !snapshot || !account.baselineAt ? 'baseline' : full ? 'check' : 'quick';

  // Scan de référence automatique : jamais en boucle (onglet fermé par l'utilisateur, compte
  // inaccessible…). Chaque essai qui n'aboutit pas double l'attente avant le suivant.
  if (kind === 'baseline' && origin === 'auto') {
    const retry = account.baselineRetry;
    const wait = retry ? Math.min(BASELINE_RETRY_MS * 2 ** (retry.attempts - 1), BASELINE_RETRY_MAX_MS) : 0;
    if (retry && Date.now() - retry.at < wait) return { started: false, reason: 'baseline-backoff' };
    await patchAccount(account.id, { baselineRetry: { attempts: (retry?.attempts ?? 0) + 1, at: Date.now() } });
  }

  const reason = scanReason(kind, origin, account, await loadAccounts(), incomplete);
  // Écart repéré par le contrôle léger : le scan s'arrête dès que ces départs sont trouvés.
  const target = reason === 'missing' && !account.pending?.full ? account.pending?.count : undefined;
  await startScan(account, kind, reason, target);
  if (kind === 'quick') {
    await chrome.alarms.create(`${ALARM_QUICK_TIMEOUT_PREFIX}${account.id}`, { when: Date.now() + QUICK_TIMEOUT_MS });
  }
  return { started: true };
}

/** Raison affichée d'un scan (tableau de bord), selon son type et son origine. */
function scanReason(
  kind: ScanKind,
  origin: CheckOrigin,
  account: TrackedAccount,
  accounts: Record<string, TrackedAccount>,
  incomplete: boolean,
): ScanReason {
  if (kind === 'quick') return 'quick';
  if (kind === 'baseline') {
    return Object.values(accounts).some((a) => a.id !== account.id && a.baselineAt) ? 'new-account' : 'baseline';
  }
  if (origin === 'user-full') return 'user';
  if (origin === 'followup') return account.pending?.count ? 'missing' : 'overflow';
  if (origin === 'retry') return 'recheck';
  if (incomplete) return 'incomplete';
  return 'safety'; // scan de contrôle périodique
}

/** « Arrêter le scan » du tableau de bord : arrêt immédiat, abonnés gardés pour le continuer. */
export async function stopScan(accountId: string): Promise<void> {
  await interruptScan(accountId);
  await updateStatus({ badge: true });
}

/**
 * « Arrêter » (onboarding) : ferme l'onglet de scan et abandonne le scan, sans rien garder
 * (ni scan partiel, ni couverture) : l'utilisateur peut ensuite importer une sauvegarde.
 */
export async function abandonScan(accountId: string): Promise<void> {
  const hadBaseline = !!(await loadAccounts())[accountId]?.baselineAt;
  const epoch = importEpoch();
  await cancelScan(accountId);
  // Analyse de fin de scan déjà lancée : on la laisse finir, puis on défait ce qu'elle a écrit.
  await settleAnalyses();
  // Sauvegarde importée entre-temps : ses données font foi, on n'y touche pas.
  if (isImporting() || epoch !== importEpoch()) return;
  await clearPartial(accountId);
  if (!hadBaseline) {
    await localKv.remove([keys.snapshot(accountId), keys.profiles(accountId)]);
    // Le total annoncé par X (`followersCount`) est gardé : c'est une info du profil, pas un
    // résultat du scan, et le prochain scan en a besoin pour sa progression (X ne renvoie pas
    // forcément le profil une seconde fois).
    await patchAccount(accountId, {
      baselineAt: undefined,
      lastScan: undefined,
      lastScanAt: undefined,
      baselineRetry: undefined,
    });
  } else {
    await patchAccount(accountId, { lastScan: undefined, baselineRetry: undefined });
  }
  await updateStatus({ badge: true });
}

/** Reprend un scan en pause dont l'échéance est passée, ou dont l'onglet a disparu. */
async function resumeIfDue(accountId?: string): Promise<void> {
  const session = await readSession();
  const id = accountId ?? session?.accountId;
  if (!session || !id || id !== session.accountId) return void (await updateStatus());
  const job = await loadJob(id);
  if (!job) return void (await updateStatus());
  if (job.finishing) {
    await recoverFinishing(id); // analyse interrompue par l'arrêt du service worker
    return void (await updateStatus());
  }
  // Plus aucune page depuis longtemps : arrêt d'office, gardé comme incomplet (jamais bloqué sans fin).
  if (await giveUpIfStalled(id)) return void (await updateStatus());
  const due =
    job.status === 'paused' &&
    job.pausedReason !== 'needs-focus' &&
    (!job.resumeAt || job.resumeAt <= Date.now());
  const orphan = job.status === 'running' && !(await isScanActive(id));
  if (due || orphan) await resumeScan(id);
  else await updateStatus();
}

export async function handleAlarm(name: string): Promise<void> {
  if (isImporting()) return; // l'import relance lui-même la planification
  if (name === ALARM_CHECK) await triggerCheck('schedule');
  // Le chien de garde rattrape aussi une session ouverte avant l'installation.
  else if (name === ALARM_WATCHDOG) await handleSessionChange();
  else if (name.startsWith(ALARM_RESUME_PREFIX)) await resumeIfDue(name.slice(ALARM_RESUME_PREFIX.length));
  else if (name.startsWith(ALARM_RETRY_PREFIX)) await checkAccount('retry', name.slice(ALARM_RETRY_PREFIX.length), name);
  else if (name.startsWith(ALARM_RECHECK_PREFIX)) await checkAccount('auto', name.slice(ALARM_RECHECK_PREFIX.length), name);
  else if (name.startsWith(ALARM_QUICK_TIMEOUT_PREFIX)) await abortQuick(name.slice(ALARM_QUICK_TIMEOUT_PREFIX.length));
}

/** Vérification propre à un compte : reportée tant qu'un autre compte est connecté sur x.com. */
async function checkAccount(origin: CheckOrigin, accountId: string, alarm: string): Promise<void> {
  const res = await triggerCheck(origin, accountId);
  if (res.started) return void deferrals.delete(alarm);
  // Choix de démarrage pas encore fait, ou limite d'abonnés : rien à vérifier, l'alarme n'a plus d'objet.
  if (res.reason === 'awaiting-choice' || res.reason === 'follower-limit') return void deferrals.delete(alarm);
  // Vérification refusée pour l'instant (autre compte connecté, scan déjà en cours, import,
  // pause…) : reportée plutôt que perdue, avec une attente qui double à chaque refus (un compte
  // qui ne se reconnecte plus ne réveille pas le service worker toutes les 30 min indéfiniment).
  const tries = deferrals.get(alarm) ?? 0;
  deferrals.set(alarm, tries + 1);
  const base = res.reason === 'account-switched' || res.reason === 'disconnected' ? OTHER_ACCOUNT_DELAY_MS : BUSY_DELAY_MS;
  await chrome.alarms.create(alarm, { when: Date.now() + Math.min(base * 2 ** tries, MAX_DEFER_MS) });
}

/**
 * Connexion, déconnexion ou bascule de compte sur x.com. Appelé de plusieurs endroits à la
 * fois (réveil, cookies, chien de garde) : les appels passent l'un après l'autre.
 */
export function handleSessionChange(): Promise<void> {
  return sessionQueue.run(onSessionChange);
}
const sessionQueue = createSerialQueue();

async function onSessionChange(): Promise<void> {
  if (isImporting()) return;
  const session = await readSession();
  // Compte retiré pendant qu'il était connecté : oublié dès qu'on se déconnecte ou change de
  // compte, pour qu'une reconnexion le fasse de nouveau détecter.
  const dismissed = await localKv.get<string>(keys.dismissed);
  if (dismissed && dismissed !== session?.accountId) await localKv.remove(keys.dismissed);
  if (!session) return void (await updateStatus());
  if (dismissed === session.accountId && !(await loadAccounts())[session.accountId]) return void (await updateStatus());
  // Scan d'un autre compte en cours : X servirait sa liste avec la session du nouveau compte.
  await suspendForeignScan(session.accountId);
  const accounts = await loadAccounts();
  const job = await loadJob(session.accountId);
  if (!accounts[session.accountId] || (!job && !(await loadSnapshot(session.accountId)))) {
    // Premier compte : l'onboarding lance le scan de référence, dans un onglet au premier plan.
    const firstSetup = !isOnboarded(accounts);
    if (firstSetup) {
      await ensureActiveAccount();
      await updateStatus();
    } else {
      // Nouveau compte : scan de référence (avec attente croissante s'il échoue).
      const res = await triggerCheck('auto');
      if (!res.started) await updateStatus();
    }
  } else if (job) {
    await resumeIfDue(session.accountId);
  } else {
    await updateStatus();
  }
}
