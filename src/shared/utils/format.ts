/** Formats d'affichage en français. */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

const numberFmt = new Intl.NumberFormat('fr-FR');
const dayMonth = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short' });
const dayMonthYear = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' });
const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' });

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

function isYesterday(at: number, now: number): boolean {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  return at < start.getTime() && at >= start.getTime() - DAY;
}

/** Forme courte de la popup : « 2 h », « hier », « 3 j », « 29 oct. ». */
export function formatAgoShort(at: number, now = Date.now()): string {
  const diff = Math.max(0, now - at);
  if (diff < MIN) return 'maint.';
  if (diff < HOUR) return `${Math.floor(diff / MIN)} min`;
  if (isYesterday(at, now)) return 'hier';
  if (diff < DAY) return `${Math.floor(diff / HOUR)} h`;
  if (diff < 7 * DAY) return `${Math.max(2, Math.floor(diff / DAY))} j`;
  return formatDate(at, now);
}

/** Forme longue : « il y a 2 h », « hier, 21:40 », « 29 oct. ». */
export function formatAgo(at: number, now = Date.now()): string {
  const diff = Math.max(0, now - at);
  if (diff < MIN) return 'à l’instant';
  if (diff < HOUR) return `il y a ${Math.floor(diff / MIN)} min`;
  if (isYesterday(at, now)) return `hier, ${formatTime(at)}`;
  if (diff < DAY) return `il y a ${Math.floor(diff / HOUR)} h`;
  return formatDate(at, now);
}

/** « dans 5 h 48 », « dans 12 min ». */
export function formatIn(at: number, now = Date.now()): string {
  const diff = Math.max(0, at - now);
  if (diff < HOUR) return `dans ${Math.max(1, Math.round(diff / MIN))} min`;
  const h = Math.floor(diff / HOUR);
  const m = Math.floor((diff % HOUR) / MIN);
  return m ? `dans ${h} h ${String(m).padStart(2, '0')}` : `dans ${h} h`;
}

/** Durée observée : « 10 jours », « 3 semaines », « 5 mois », « 1 an ». */
export function formatDuration(ms: number): string {
  const days = Math.floor(ms / DAY);
  if (days < 1) return plural(Math.max(1, Math.floor(ms / HOUR)), 'heure');
  if (days < 14) return plural(days, 'jour');
  if (days < 60) return `${Math.floor(days / 7)} semaines`;
  if (days < 365) return `${Math.floor(days / 30)} mois`;
  return plural(Math.floor(days / 365), 'an');
}

/** « 1 abonné », « 2 abonnés », « 1 250 abonnés » (nombre formaté). */
export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${formatNumber(n)} ${n > 1 ? pluralForm : singular}`;
}

/** Accord seul (« s » ou rien), pour les phrases où le nombre est déjà écrit. */
export const pluralS = (n: number) => (n > 1 ? 's' : '');

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
  if (!at) return 'dans quelques minutes';
  const s = Math.max(0, Math.round((at - now) / 1000));
  if (s === 0) return 'imminente';
  const m = Math.floor(s / 60);
  return `dans ${m > 0 ? `${m} min ` : ''}${s % 60} s`;
}

/** Temps écoulé court : « 45 s », « 3 min ». */
export function formatElapsedShort(since: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - since) / 1000));
  return s < 60 ? `${s} s` : `${Math.floor(s / 60)} min`;
}

/** Compteur de badge : « 7 », « 99+ », vide à 0. */
export const formatBadgeCount = (n: number) => (n <= 0 ? '' : n > 99 ? '99+' : String(n));

/** « aujourd’hui, 09:14 » ou « 12 oct. ». */
export const formatDayOrDate = (at: number, now = Date.now()) =>
  new Date(at).toDateString() === new Date(now).toDateString() ? `aujourd’hui, ${formatTime(at)}` : formatDate(at, now);

export function initials(name: string): string {
  const parts = name.replace(/[@_.-]+/g, ' ').trim().split(/\s+/).filter(Boolean);
  const letters = parts.length > 1 ? `${parts[0]![0]}${parts[1]![0]}` : (parts[0] ?? '?').slice(0, 2);
  return letters.toUpperCase();
}
