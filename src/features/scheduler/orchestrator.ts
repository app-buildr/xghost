import {
  ALARM_CHECK,
  ALARM_QUICK_TIMEOUT_PREFIX,
  ALARM_RECHECK_PREFIX,
  ALARM_RESUME_PREFIX,
  ALARM_RETRY_PREFIX,
  ALARM_WATCHDOG,
} from './alarms';
import {
  getMachineId,
  getSelectedAccountId,
  loadAccounts,
  setSelectedAccountId,
  updateAccounts,
} from '@/features/accounts/repository';
import { refreshBadge } from '@/features/alerts/badge';
import { notifyAccountAdded } from '@/features/alerts/notifications';
import { loadJob, loadSnapshot } from '@/features/followers-sync/repository';
import { abortQuick, isScanActive, resumeScan, setScanHooks, startScan } from '@/features/followers-sync/scan-engine';
import { loadSettings } from '@/features/settings/repository';
import { applyQuickCheck, applyScan, saveIncomplete } from '@/features/unfollow-detection/apply';
import { readSession } from '@/features/x-api/session';
import { localKv } from '@/shared/storage/kv';
import { keys } from '@/shared/storage/keys';
import type { GlobalStatus, ScanKind, ScanReason, TrackedAccount } from '@/shared/types';

/**
 * Orchestration : alarmes, détection automatique des comptes (§ 4.4),
 * vérifications périodiques (§ 4.2), reprises et coordination multi-machines (§ 5.4).
 */

/** Un scan complet de contrôle tous les N contrôles légers. */
const SAFETY_EVERY = 10;
/** Durée maximale d'un contrôle léger (chargement de la page et de la première liste). */
const QUICK_TIMEOUT_MS = 90_000;

/**
 * Origine d'une vérification :
 * - `user` : « Vérifier maintenant » → contrôle léger (abonnés les plus récents + total) ;
 * - `user-full` : « Scan complet », « Continuer le scan » → scan complet ;
 * - `schedule` : alarme périodique → contrôle léger, ou scan complet si le dernier est incomplet ;
 * - `auto` : reprise, nouveau compte, ou départs repérés par le contrôle léger → idem `schedule`,
 *   sans la coordination multi-machines ;
 * - `followup` : le contrôle léger a vu le total baisser → scan complet immédiat.
 *
 * Tout scan complet a lieu dans l'onglet x.com épinglé en arrière-plan (§ 4.6).
 */
export type CheckOrigin = 'user' | 'user-full' | 'schedule' | 'auto' | 'followup';

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
    // Le contrôle léger a repéré des départs : le scan complet les identifie aussitôt.
    if (job.kind !== 'quick') return;
    const account = (await loadAccounts())[job.accountId];
    if (account?.pending) await triggerCheck('followup');
  },
  async onInterrupted(job) {
    await saveIncomplete(job);
  },
  async onStateChange() {
    await updateStatus();
  },
  async scheduleResume(accountId, at) {
    await chrome.alarms.create(`${ALARM_RESUME_PREFIX}${accountId}`, { when: at });
  },
});

export async function setupAlarms(): Promise<void> {
  const { frequencyHours } = await loadSettings();
  const existing = await chrome.alarms.get(ALARM_CHECK);
  if (existing?.periodInMinutes !== frequencyHours * 60) {
    await chrome.alarms.create(ALARM_CHECK, { periodInMinutes: frequencyHours * 60 });
  }
  if (!(await chrome.alarms.get(ALARM_WATCHDOG))) {
    await chrome.alarms.create(ALARM_WATCHDOG, { periodInMinutes: 1 });
  }
}

/** État global affiché par l'icône et les interfaces. */
export async function updateStatus(): Promise<GlobalStatus> {
  const session = await readSession();
  const status: GlobalStatus = {
    session: session ? 'ok' : 'disconnected',
    activeAccountId: session?.accountId,
    updatedAt: Date.now(),
  };
  await localKv.set({ [keys.status]: status });
  await refreshBadge();
  return status;
}

/**
 * Enregistre le compte connecté s'il est inconnu (ajout automatique, § 4.4).
 * Le @handle et le nombre d'abonnés sont complétés pendant le scan, à partir des
 * réponses lues dans la page x.com.
 */
export async function ensureActiveAccount(): Promise<TrackedAccount | undefined> {
  const session = await readSession();
  if (!session) return undefined;
  const accounts = await loadAccounts();
  const known = accounts[session.accountId];
  if (known) return known;

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

/** Lance la vérification du compte connecté (voir `CheckOrigin`). */
export async function triggerCheck(origin: CheckOrigin): Promise<{ started: boolean; reason?: string }> {
  const account = await ensureActiveAccount();
  if (!account) {
    await updateStatus();
    return { started: false, reason: 'disconnected' };
  }
  const user = origin === 'user' || origin === 'user-full';

  const existing = await loadJob(account.id);
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
  // Dernier scan incomplet : on le continue (union) au lieu d'un simple contrôle léger (§ 4.7).
  const incomplete = account.lastScan ? !account.lastScan.complete : false;
  // Liste classée du plus récent au plus ancien : le contrôle léger suffit tant que le total
  // ne baisse pas ; sinon il enchaîne lui-même un scan complet (`followup`).
  // Scan de contrôle : après SAFETY_EVERY contrôles légers sans scan relu de bout en bout
  // (un scan complet manuel remet le compteur à zéro), pour rattraper ce qui aurait échappé.
  const safety = origin !== 'user' && (account.quickSinceFull ?? 0) >= SAFETY_EVERY;
  const full = origin === 'user-full' || origin === 'followup' || incomplete || safety;
  const kind: ScanKind = !snapshot ? 'baseline' : full ? 'check' : 'quick';

  if (origin === 'schedule' && kind !== 'baseline') {
    const { frequencyHours } = await loadSettings();
    const machine = await getMachineId();
    const recentElsewhere =
      account.lastScanAt &&
      account.lastScanMachine !== machine &&
      Date.now() - account.lastScanAt < frequencyHours * 3600_000 * 0.9;
    if (recentElsewhere) return { started: false, reason: 'checked-elsewhere' };
  }

  const accounts = await loadAccounts();
  const reason: ScanReason =
    kind === 'quick'
      ? 'quick'
      : kind === 'baseline'
        ? Object.values(accounts).some((a) => a.id !== account.id && a.baselineAt)
          ? 'new-account'
          : 'baseline'
        : origin === 'user-full'
          ? 'user'
          : origin === 'followup'
            ? account.pending?.count
              ? 'missing'
              : 'overflow'
            : incomplete
              ? 'incomplete'
              : 'safety';
  // Écart repéré par le contrôle léger : le scan s'arrête dès que ces départs sont trouvés.
  const target = reason === 'missing' && !account.pending?.full ? account.pending?.count : undefined;
  await startScan(account, kind, reason, target);
  if (kind === 'quick') {
    await chrome.alarms.create(`${ALARM_QUICK_TIMEOUT_PREFIX}${account.id}`, { when: Date.now() + QUICK_TIMEOUT_MS });
  }
  return { started: true };
}

/** Reprend un scan en pause dont l'échéance est passée, ou dont l'onglet a disparu. */
async function resumeIfDue(accountId?: string): Promise<void> {
  const session = await readSession();
  const id = accountId ?? session?.accountId;
  if (!session || !id || id !== session.accountId) return void (await updateStatus());
  const job = await loadJob(id);
  if (!job || job.finishing) return void (await updateStatus());
  const due =
    job.status === 'paused' &&
    job.pausedReason !== 'needs-focus' &&
    (!job.resumeAt || job.resumeAt <= Date.now());
  const orphan = job.status === 'running' && !(await isScanActive(id));
  if (due || orphan) await resumeScan(id);
  else await updateStatus();
}

export async function handleAlarm(name: string): Promise<void> {
  if (name === ALARM_CHECK) await triggerCheck('schedule');
  // Le chien de garde rattrape aussi une session ouverte avant l'installation.
  else if (name === ALARM_WATCHDOG) await handleSessionChange();
  else if (name.startsWith(ALARM_RESUME_PREFIX)) await resumeIfDue(name.slice(ALARM_RESUME_PREFIX.length));
  else if (name.startsWith(ALARM_RETRY_PREFIX)) await triggerCheck('auto');
  else if (name.startsWith(ALARM_RECHECK_PREFIX)) await triggerCheck('auto');
  else if (name.startsWith(ALARM_QUICK_TIMEOUT_PREFIX)) await abortQuick(name.slice(ALARM_QUICK_TIMEOUT_PREFIX.length));
}

/** Connexion, déconnexion ou bascule de compte sur x.com. */
export async function handleSessionChange(): Promise<void> {
  const session = await readSession();
  if (!session) return void (await updateStatus());
  const accounts = await loadAccounts();
  const job = await loadJob(session.accountId);
  if (!accounts[session.accountId] || (!job && !(await loadSnapshot(session.accountId)))) {
    // Premier compte : l'onboarding lance le scan de référence, dans un onglet au premier plan.
    const firstSetup = !Object.values(accounts).some((a) => a.baselineAt);
    if (firstSetup) {
      await ensureActiveAccount();
      await updateStatus();
    } else {
      await triggerCheck('auto'); // nouveau compte ou nouvelle machine : scan de référence
    }
  } else if (job) {
    await resumeIfDue(session.accountId);
  } else {
    await updateStatus();
  }
}
