import { SECOND } from '@/shared/utils/time';

/**
 * Noms des alarmes `chrome.alarms` (module sans effet de bord : importable par les interfaces).
 * Les alarmes par compte se terminent par l'id du compte.
 */
export const ALARM_CHECK = 'xg:check';
export const ALARM_WATCHDOG = 'xg:watchdog';
export const ALARM_RESUME_PREFIX = 'xg:resume:';
export const ALARM_RETRY_PREFIX = 'xg:retry:';
export const ALARM_QUICK_TIMEOUT_PREFIX = 'xg:quickto:';
/** Revérification légère quand le total X semblait en retard sur la liste. */
export const ALARM_RECHECK_PREFIX = 'xg:recheck:';

/** Durée maximale d'un contrôle léger (chargement de la page et de la première liste). */
const QUICK_TIMEOUT_MS = 90 * SECOND;

export const quickTimeoutAlarm = (accountId: string) => `${ALARM_QUICK_TIMEOUT_PREFIX}${accountId}`;
export const armQuickTimeout = (accountId: string) =>
  chrome.alarms.create(quickTimeoutAlarm(accountId), { when: Date.now() + QUICK_TIMEOUT_MS });
export const clearQuickTimeout = (accountId: string) => chrome.alarms.clear(quickTimeoutAlarm(accountId));

const ACCOUNT_PREFIXES = [ALARM_RESUME_PREFIX, ALARM_RETRY_PREFIX, ALARM_QUICK_TIMEOUT_PREFIX, ALARM_RECHECK_PREFIX];

/** Supprime toutes les alarmes d'un compte (retrait du compte). */
export const clearAccountAlarms = (accountId: string) =>
  Promise.all(ACCOUNT_PREFIXES.map((prefix) => chrome.alarms.clear(`${prefix}${accountId}`)));

/** Heure de la prochaine vérification automatique (aucune en mode manuel). */
export const nextCheckAt = () => chrome.alarms.get(ALARM_CHECK).then((a) => a?.scheduledTime);
