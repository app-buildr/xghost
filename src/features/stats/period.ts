/**
 * Périodes des statistiques (§ 3.2, § 3.4) : popup (24 h / 7 j / 30 j / Tout) et tableau de bord
 * (7 j / 30 j / 90 j / Tout). Fonctions pures, testées dans stats.test.ts.
 */

export const DAY = 24 * 3600_000;

export type Period = '24h' | '7d' | '30d' | '90d' | 'all';
export const POPUP_PERIODS = ['24h', '7d', '30d', 'all'] as const satisfies readonly Period[];
export const DASHBOARD_PERIODS = ['7d', '30d', '90d', 'all'] as const satisfies readonly Period[];
export type PopupPeriod = (typeof POPUP_PERIODS)[number];
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

const DAYS: Record<Exclude<Period, 'all' | '24h'>, number> = { '7d': 7, '30d': 30, '90d': 90 };

/** Minuit (heure locale) du jour de `at`. */
export function startOfDay(at: number): number {
  const d = new Date(at);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/**
 * Début d'une période. 24 h : glissant (maintenant moins 24 h) ; 7, 30, 90 jours : depuis minuit,
 * aujourd'hui compris ; Tout : depuis la référence du compte. Jamais avant la référence : avant,
 * xGhost n'a pas de données.
 */
export function periodStart(period: Period, now: number, baselineAt?: number): number {
  const floor = baselineAt ?? now;
  if (period === 'all') return floor;
  const start = period === '24h' ? now - DAY : startOfDay(now) - (DAYS[period] - 1) * DAY;
  return Math.max(start, baselineAt ?? start);
}

/** Granularité des graphes : par jour jusqu'à 30 jours, par semaine au-delà (§ 3.4). */
export const activityUnit = (period: DashboardPeriod): 'day' | 'week' =>
  period === '7d' || period === '30d' ? 'day' : 'week';

/** Solde net : par semaine, par mois sur « Tout » (§ 3.4). */
export const netUnit = (period: DashboardPeriod): 'week' | 'month' => (period === 'all' ? 'month' : 'week');
