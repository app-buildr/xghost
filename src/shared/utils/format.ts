import { LOCALE, t } from '@/shared/i18n';
import { DAY, daysBefore, HOUR, isSameDay, MINUTE as MIN, startOfDay } from '@/shared/utils/time';

/** Formats d'affichage, dans la langue du navigateur (textes dans locales/<langue>/format.json). */

const numberFmt = new Intl.NumberFormat(LOCALE);
/** « 12 oct. » (axes des graphiques, dates courtes). */
export const dayMonth = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short' });
/** « mercredi 4 novembre » (infobulles des graphiques). */
export const longDay = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long' });
const dateTime = new Intl.DateTimeFormat(LOCALE, { dateStyle: 'medium', timeStyle: 'short' });
/** « juil. » (mois des graphiques), avec l'année (« juil. 26 ») quand la période en couvre plusieurs. */
export const shortMonth = new Intl.DateTimeFormat(LOCALE, { month: 'short' });
export const shortMonthYear = new Intl.DateTimeFormat(LOCALE, { month: 'short', year: '2-digit' });
const dayMonthYear = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'short', year: 'numeric' });
const time = new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' });

export const formatNumber = (n: number) => numberFmt.format(n);

export function formatSigned(n: number): string {
  if (n > 0) return `+${formatNumber(n)}`;
  if (n < 0) return `−${formatNumber(-n)}`;
  return '0';
}

/** « 12 oct. » (année ajoutée si différente de l'année courante). */
export function formatDate(at: number, now = Date.now()): string {
  const d = new Date(at);
  return d.getFullYear() === new Date(now).getFullYear() ? dayMonth.format(d) : dayMonthYear.format(d);
}

export const formatTime = (at: number) => time.format(new Date(at));

/** Date et heure complètes : « 4 nov. 2026, 09:14 ». */
export const formatDateTime = (at: number) => dateTime.format(new Date(at));

/** Veille calendaire de `now` (sûr aux changements d'heure). */
const isYesterday = (at: number, now: number) => at < startOfDay(now) && at >= daysBefore(now, 1);

/** Forme courte de la popup : « 2 h », « hier », « 3 j », « 29 oct. ». */
export function formatAgoShort(at: number, now = Date.now()): string {
  const diff = Math.max(0, now - at);
  if (diff < MIN) return t('format.agoShort.now');
  if (diff < HOUR) return t('format.agoShort.minutes', { count: Math.floor(diff / MIN) });
  if (isYesterday(at, now)) return t('format.agoShort.yesterday');
  if (diff < DAY) return t('format.agoShort.hours', { count: Math.floor(diff / HOUR) });
  if (diff < 7 * DAY) return t('format.agoShort.days', { count: Math.max(2, Math.floor(diff / DAY)) });
  return formatDate(at, now);
}

/** Forme longue : « il y a 2 h », « hier, 21:40 », « 29 oct. ». */
export function formatAgo(at: number, now = Date.now()): string {
  const diff = Math.max(0, now - at);
  if (diff < MIN) return t('format.ago.now');
  if (diff < HOUR) return t('format.ago.minutes', { count: Math.floor(diff / MIN) });
  if (isYesterday(at, now)) return t('format.ago.yesterday', { time: formatTime(at) });
  if (diff < DAY) return t('format.ago.hours', { count: Math.floor(diff / HOUR) });
  return formatDate(at, now);
}

/** « dans 5 h 48 », « dans 12 min ». */
export function formatIn(at: number, now = Date.now()): string {
  const diff = Math.max(0, at - now);
  if (diff < HOUR) return t('format.in.minutes', { count: Math.max(1, Math.round(diff / MIN)) });
  const h = Math.floor(diff / HOUR);
  const m = Math.floor((diff % HOUR) / MIN);
  return m ? t('format.in.hoursMinutes', { h, m: String(m).padStart(2, '0') }) : t('format.in.hours', { count: h });
}

/** Durée observée : « 10 jours », « 3 semaines », « 5 mois », « 1 an ». */
export function formatDuration(ms: number): string {
  const days = Math.floor(ms / DAY);
  if (days < 1) return t('format.duration.hours', { count: Math.max(1, Math.floor(ms / HOUR)) });
  if (days < 14) return t('format.duration.days', { count: days });
  if (days < 60) return t('format.duration.weeks', { count: Math.floor(days / 7) });
  if (days < 365) return t('format.duration.months', { count: Math.floor(days / 30) });
  return t('format.duration.years', { count: Math.floor(days / 365) });
}

/** Pourcentage affiché : « 41 % » en français, « 41% » en anglais. */
export const formatPercent = (pct: number) => t('format.percent', { pct });

/**
 * Pourcentage arrondi. `capBelowTotal` : jamais 100 % tant qu'il manque quelque chose.
 * Sans total connu : 0 (ou 100 si `emptyIsFull`).
 */
export function percentOf(part: number, total: number, { capBelowTotal = true, emptyIsFull = false } = {}): number {
  if (total <= 0) return emptyIsFull ? 100 : 0;
  const pct = Math.min(100, Math.round((part / total) * 100));
  return capBelowTotal && part < total ? Math.min(pct, 99) : pct;
}

/** Compte à rebours : « dans 3 min 12 s », « imminente », « dans quelques minutes ». */
export function formatCountdown(at: number | undefined, now = Date.now()): string {
  if (!at) return t('format.countdown.unknown');
  const s = Math.max(0, Math.round((at - now) / 1000));
  if (s === 0) return t('format.countdown.now');
  const m = Math.floor(s / 60);
  return m > 0 ? t('format.countdown.minutesSeconds', { m, s: s % 60 }) : t('format.countdown.seconds', { s });
}

/** Temps écoulé court : « 45 s », « 3 min ». */
export function formatElapsedShort(since: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - since) / 1000));
  return s < 60 ? t('format.elapsed.seconds', { s }) : t('format.elapsed.minutes', { m: Math.floor(s / 60) });
}

/** Compteur de badge : « 7 », « 99+ », vide à 0. */
export const formatBadgeCount = (n: number) => (n <= 0 ? '' : n > 99 ? '99+' : String(n));

/** « aujourd’hui, 09:14 » ou « 12 oct. ». */
export const formatDayOrDate = (at: number, now = Date.now()) =>
  isSameDay(at, now)
    ? t('format.todayAt', { time: formatTime(at) })
    : formatDate(at, now);

export function initials(name: string): string {
  const parts = name.replace(/[@_.-]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]![0]}${parts[1]![0]}` : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}

/** Compteur d'un scan : « 643 / 1 573 », ou « 643 » tant que le total de X est inconnu. */
export const formatProgressCount = (collected: number, expected: number) =>
  expected > 0
    ? t('format.progressCount', { collected: formatNumber(collected), expected: formatNumber(expected) })
    : formatNumber(collected);

const conjunction = new Intl.ListFormat(LOCALE, { style: 'long', type: 'conjunction' });

/** Énumération dans la langue : « a et b », « a, b et c ». */
export const formatList = (items: readonly string[]) => conjunction.format(items);

/** Morceaux d'information assemblés avec le séparateur de la langue (« @x · suivi pendant 3 mois »). */
export const joinParts = (parts: readonly (string | false | undefined)[]) =>
  parts.filter(Boolean).join(t('format.separator'));
