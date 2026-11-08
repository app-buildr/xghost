import { hasKnownHandle } from '@/domain/accounts/model';
import { rateLimitText, rateLimitTitle } from '@/features/scan-status/messages';
import { t } from '@/shared/i18n';
import type { SimpleTabCommand, TabCommand, VeilState } from '@/shared/messaging/protocol';
import { keys } from '@/shared/storage/keys';
import { localKv } from '@/shared/storage/kv';
import type { ScanJob, TrackedAccount } from '@/shared/types';
import { formatNumber, formatPercent, percentOf } from '@/shared/utils/format';
import { SECOND } from '@/shared/utils/time';
import { remainingLabel } from './estimate';

/** Échanges avec l'onglet de scan. */

/** Réponse maximale attendue de l'onglet : un onglet gelé ne bloque pas la file des événements. */
const TAB_REPLY_MS = 3 * SECOND;

export interface ScanTab {
  tabId: number;
  accountId: string;
  /** Onglet ouvert pour vérifier le follow back des départs (pas de scan de la liste). */
  purpose?: 'follow-check';
  /** Vérification : profil ouvert, par son id et son @handle (onglet resté d'avant un redémarrage de Chrome). */
  profileId?: string;
  handle?: string;
}

/** Commande vers l'onglet de scan ; les commandes sans données s'écrivent par leur seul nom. */
export async function send(tabId: number, command: TabCommand | SimpleTabCommand): Promise<unknown> {
  const reply = chrome.tabs.sendMessage(tabId, typeof command === 'string' ? { xgCmd: command } : command);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<undefined>((resolve) => {
    timer = setTimeout(() => resolve(undefined), TAB_REPLY_MS);
  });
  try {
    return await Promise.race([reply, timeout]);
  } catch {
    return undefined; // contenu pas encore prêt : nouvel essai au prochain événement
  } finally {
    clearTimeout(timer);
  }
}

/** État du voile, avec ses textes traduits. */
export function veilState(job: ScanJob, account: TrackedAccount): VeilState {
  const collected = job.count ?? 0;
  const expected = job.expectedTotal;
  const paused = job.status === 'paused' && job.pausedReason === 'rate-limit';
  const percent = percentOf(collected, expected);
  return {
    state: paused ? 'rate-limit' : 'running',
    percent,
    resumeAt: job.resumeAt,
    texts: {
      brand: t('common.appName'),
      handle: hasKnownHandle(account) ? `@${account.handle}` : '',
      title: paused ? rateLimitTitle() : t('common.veil.title'),
      text: paused ? rateLimitText() : t('common.veil.text'),
      count: formatNumber(collected),
      total: expected > 0 ? t('format.ofTotal', { expected: formatNumber(expected) }) : '',
      percent: expected > 0 ? formatPercent(percent) : '',
      foot:
        remainingLabel({ collected, seeded: job.seeded ?? 0, expected, startedAt: job.startedAt }) ?? t('common.veil.computing'),
      resume: t('common.veil.resume', { countdown: '{{countdown}}' }),
      countdown: {
        minutesSeconds: t('format.countdown.minutesSeconds', { m: '{{m}}', s: '{{s}}' }),
        seconds: t('format.countdown.seconds', { s: '{{s}}' }),
        now: t('format.countdown.now'),
        unknown: t('format.countdown.unknown'),
      },
    },
  };
}

/** Met à jour l'overlay de l'onglet de scan (compteur, limite de X). */
export async function sendVeil(job: ScanJob, account: TrackedAccount): Promise<void> {
  if (!job.visible || job.tabId === undefined) return;
  await send(job.tabId, { xgCmd: 'progress', ...veilState(job, account) });
}

export async function tabExists(tabId: number | undefined): Promise<boolean> {
  if (tabId === undefined) return false;
  return chrome.tabs.get(tabId).then(
    () => true,
    () => false,
  );
}

export const getScanTab = () => localKv.get<ScanTab>(keys.scanTab);

/**
 * Le script de page est-il en place ? Seule une absence de réponse franche dit non : un onglet
 * occupé qui tarde à répondre est sain, le recharger ferait repartir le scan du haut.
 */
export async function isHooked(tabId: number): Promise<boolean> {
  const reply = chrome.tabs.sendMessage(tabId, { xgCmd: 'ping' } satisfies TabCommand).then(Boolean, () => false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const busy = new Promise<boolean>((resolve) => {
    timer = setTimeout(() => resolve(true), TAB_REPLY_MS);
  });
  try {
    return await Promise.race([reply, busy]);
  } finally {
    clearTimeout(timer);
  }
}

/** Enregistre l'onglet de scan : c'est lui qui fait foi, rien dans la page ne le désigne. */
export const registerScanTab = (tabId: number, accountId: string, extra: Pick<ScanTab, 'purpose' | 'profileId' | 'handle'> = {}) =>
  localKv.set({ [keys.scanTab]: { tabId, accountId, ...extra } satisfies ScanTab });

/** Change la page de l'onglet de scan. */
export const navigate = (tabId: number, url: string) => chrome.tabs.update(tabId, { url }).catch(() => undefined);

export async function closeTab(job: ScanJob): Promise<void> {
  const tabId = job.tabId;
  job.tabId = undefined;
  // La référence de l'onglet de scan n'est effacée que si c'est bien celui de ce scan (un autre
  // compte peut être en train de scanner).
  const scanTab = await getScanTab();
  if (scanTab && scanTab.accountId === job.accountId) await localKv.remove(keys.scanTab);
  if (tabId === undefined) return;
  await send(tabId, 'drive-stop'); // retire la protection « quitter la page ? »
  await chrome.tabs.remove(tabId).catch(() => undefined);
}
