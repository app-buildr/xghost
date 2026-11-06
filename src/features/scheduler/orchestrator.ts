import { createSerialQueue } from '@/shared/utils/serial';
import {
  ALARM_CHECK,
  ALARM_QUICK_TIMEOUT_PREFIX,
  ALARM_RECHECK_PREFIX,
  ALARM_RESUME_PREFIX,
  ALARM_RETRY_PREFIX,
  ALARM_WATCHDOG,
  armQuickTimeout,
  clearAccountAlarms,
  clearQuickTimeout,
} from './alarms';
import { exceedsFollowerLimit } from '@/domain/accounts/limit';
import { isOnboarded } from '@/domain/accounts/model';
import {
  getSelectedAccountId,
  loadAccounts,
  patchAccount,
  setSelectedAccountId,
  updateAccounts,
} from '@/features/accounts/repository';
import { refreshBadge } from '@/features/alerts/badge';
import { importEpoch, isImporting, trackWork } from '@/shared/storage/import-lock';
import { notifyAccountAdded } from '@/features/alerts/notifications';
import { isStalled } from '@/features/followers-sync/scan-state';
import { clearPartial, loadJob, loadProgress, loadSnapshot } from '@/features/followers-sync/repository';
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
import type { CheckRefusal } from '@/shared/messaging/protocol';
import { localKv } from '@/shared/storage/kv';
import { keys } from '@/shared/storage/keys';
import type { GlobalStatus, TrackedAccount } from '@/shared/types';
import { HOUR, MINUTE } from '@/shared/utils/time';
import { planCheck, type CheckOrigin } from './check-policy';
import { loadStatus, saveStatus } from './status';

/**
 * Orchestration : alarmes, détection automatique des comptes (§ 4.4),
 * vérifications périodiques (§ 4.2), reprises et nouvelles tentatives.
 */

/** Alarme d'un autre compte que celui connecté sur x.com : reportée de ce délai. */
const OTHER_ACCOUNT_DELAY_MS = 30 * MINUTE;
/** Report d'une vérification refusée parce qu'autre chose est en cours. */
const BUSY_DELAY_MS = 5 * MINUTE;
/** Attente maximale entre deux reports d'une même vérification. */
const MAX_DEFER_MS = 12 * HOUR;
/** Reports successifs par alarme : dans le stockage de session, le service worker s'arrêtant entre deux. */
const DEFERRALS_KEY = 'deferrals';
const loadDeferrals = async (): Promise<Record<string, number>> =>
  ((await chrome.storage.session.get(DEFERRALS_KEY))[DEFERRALS_KEY] as Record<string, number> | undefined) ?? {};
async function setDeferral(alarm: string, tries: number | undefined): Promise<void> {
  const all = await loadDeferrals();
  if (tries === undefined) delete all[alarm];
  else all[alarm] = tries;
  await chrome.storage.session.set({ [DEFERRALS_KEY]: all });
}

type CheckResult = { started: boolean; reason?: CheckRefusal };

setScanHooks({
  async onComplete(job) {
    if (job.kind === 'quick') {
      await clearQuickTimeout(job.accountId);
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
    await syncWatchdog();
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
  await clearAccountAlarms(accountId);
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
  await syncWatchdog();
}

/**
 * Chien de garde : seulement tant qu'un scan existe (reprise, blocage), ou que le compte connecté
 * attend un nouvel essai de son scan de référence. Le reste du temps, rien ne réveille le service
 * worker chaque minute : les cookies signalent les changements de session.
 */
async function syncWatchdog(): Promise<void> {
  // Compte connecté seulement : le scan d'un autre compte ne peut pas reprendre sans lui, et un
  // changement de compte réveille déjà le service worker.
  const activeId = (await loadStatus())?.activeAccountId;
  const active = activeId ? (await loadAccounts())[activeId] : undefined;
  const needed = !!active && (!!(await loadProgress(active.id)) || (!!active.baselineRetry && !active.baselineAt));
  const existing = await chrome.alarms.get(ALARM_WATCHDOG);
  if (needed && !existing) await chrome.alarms.create(ALARM_WATCHDOG, { periodInMinutes: 1 });
  if (!needed && existing) await chrome.alarms.clear(ALARM_WATCHDOG);
}

/**
 * État global affiché par l'icône et les interfaces. Écrit seulement s'il change (le chien de
 * garde l'appelle chaque minute pendant un scan) ; l'icône est recalculée à ce moment-là, ou si `badge` le
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
export function triggerCheck(origin: CheckOrigin, accountId?: string): Promise<CheckResult> {
  return trackWork(() => runCheck(origin, accountId));
}

async function runCheck(origin: CheckOrigin, accountId?: string): Promise<CheckResult> {
  if (isImporting()) return { started: false, reason: 'importing' };
  // Avant tout ajout de compte : un refus ne doit pas réajouter le compte connecté.
  if (accountId) {
    const session = await readSession();
    if (session && session.accountId !== accountId) return { started: false, reason: 'account-switched' };
  }
  const account = await ensureActiveAccount(origin === 'user' || origin === 'user-full');
  if (!account) {
    await updateStatus();
    return { started: false, reason: 'disconnected' };
  }
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
    await armQuickTimeout(account.id);
    await startScan(account, 'quick', 'quick');
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
    if (await resumeScan(account.id)) return { started: true };
    // Scan trop ancien, écarté : on repart d'une vérification normale.
  }

  // Premier démarrage : rien ne part vers X tant que l'utilisateur n'a pas choisi entre une
  // nouvelle synchronisation et l'import d'une sauvegarde (§ 3.3).
  const accounts = await loadAccounts();
  if (!user && !isOnboarded(accounts)) return { started: false, reason: 'awaiting-choice' };

  const hasSnapshot = !!(await loadSnapshot(account.id));
  const { kind, reason, target, backoff } = planCheck({ origin, account, accounts, hasSnapshot, now: Date.now() });
  if (backoff === 'wait') return { started: false, reason: 'baseline-backoff' };
  if (backoff) await patchAccount(account.id, { baselineRetry: backoff });
  // Délai armé avant le scan : un arrêt du service worker entre les deux ne le laisse pas sans limite.
  if (kind === 'quick') await armQuickTimeout(account.id);
  await startScan(account, kind, reason, target);
  return { started: true };
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
  // État léger : le scan complet fait plusieurs Mo, cette fonction tourne chaque minute pendant un scan.
  const job = await loadProgress(id);
  if (!job) return void (await updateStatus());
  if (job.finishing) {
    await recoverFinishing(id); // analyse interrompue par l'arrêt du service worker
    return void (await updateStatus());
  }
  // Plus aucune page depuis longtemps : arrêt d'office, gardé comme incomplet (jamais bloqué sans fin).
  if (isStalled(job, Date.now()) && (await giveUpIfStalled(id))) return void (await updateStatus());
  const due =
    job.status === 'paused' &&
    job.pausedReason !== 'needs-focus' &&
    (!job.resumeAt || job.resumeAt <= Date.now());
  const orphan = job.status === 'running' && !(await isScanActive(id));
  if (due || orphan) await resumeScan(id).then(() => undefined);
  else await updateStatus();
}

export function handleAlarm(name: string): Promise<void> {
  return trackWork(() => onAlarm(name));
}

/** Contrôle léger sans réponse de la page : compté, pour le signaler s'il se répète. */
async function onQuickTimeout(accountId: string): Promise<void> {
  if (!(await abortQuick(accountId))) return;
  await updateAccounts((all) => {
    const account = all[accountId];
    if (account) all[accountId] = { ...account, quickFailures: (account.quickFailures ?? 0) + 1 };
  });
}

async function onAlarm(name: string): Promise<void> {
  if (isImporting()) return; // l'import relance lui-même la planification
  if (name === ALARM_CHECK) await triggerCheck('schedule');
  else if (name === ALARM_WATCHDOG) await handleSessionChange();
  else if (name.startsWith(ALARM_RESUME_PREFIX)) await resumeIfDue(name.slice(ALARM_RESUME_PREFIX.length));
  else if (name.startsWith(ALARM_RETRY_PREFIX)) await checkAccount('retry', name.slice(ALARM_RETRY_PREFIX.length), name);
  else if (name.startsWith(ALARM_RECHECK_PREFIX)) await checkAccount('auto', name.slice(ALARM_RECHECK_PREFIX.length), name);
  else if (name.startsWith(ALARM_QUICK_TIMEOUT_PREFIX)) await onQuickTimeout(name.slice(ALARM_QUICK_TIMEOUT_PREFIX.length));
}

/** Vérification propre à un compte : reportée tant qu'un autre compte est connecté sur x.com. */
async function checkAccount(origin: CheckOrigin, accountId: string, alarm: string): Promise<void> {
  const res = await triggerCheck(origin, accountId);
  if (res.started) return setDeferral(alarm, undefined);
  // Choix de démarrage pas encore fait, ou limite d'abonnés : rien à vérifier, l'alarme n'a plus d'objet.
  if (res.reason === 'awaiting-choice' || res.reason === 'follower-limit') return setDeferral(alarm, undefined);
  // Vérification refusée pour l'instant (autre compte connecté, scan déjà en cours, import,
  // pause…) : reportée plutôt que perdue, avec une attente qui double à chaque refus (un compte
  // qui ne se reconnecte plus ne réveille pas le service worker toutes les 30 min indéfiniment).
  const tries = (await loadDeferrals())[alarm] ?? 0;
  await setDeferral(alarm, tries + 1);
  const base = res.reason === 'account-switched' || res.reason === 'disconnected' ? OTHER_ACCOUNT_DELAY_MS : BUSY_DELAY_MS;
  await chrome.alarms.create(alarm, { when: Date.now() + Math.min(base * 2 ** tries, MAX_DEFER_MS) });
}

/**
 * Connexion, déconnexion ou bascule de compte sur x.com. Appelé de plusieurs endroits à la
 * fois (réveil, cookies, chien de garde) : les appels passent l'un après l'autre.
 */
export function handleSessionChange(): Promise<void> {
  return trackWork(() =>
    sessionQueue.run(async () => {
      try {
        await onSessionChange();
      } finally {
        await syncWatchdog();
      }
    }),
  );
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
  const job = await loadProgress(session.accountId);
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
