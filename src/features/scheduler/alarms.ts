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

const ACCOUNT_PREFIXES = [ALARM_RESUME_PREFIX, ALARM_RETRY_PREFIX, ALARM_QUICK_TIMEOUT_PREFIX, ALARM_RECHECK_PREFIX];

/** Supprime toutes les alarmes d'un compte (retrait du compte). */
export const clearAccountAlarms = (accountId: string) =>
  Promise.all(ACCOUNT_PREFIXES.map((prefix) => chrome.alarms.clear(`${prefix}${accountId}`)));
