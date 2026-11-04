/**
 * Périodes des statistiques (§ 3.2, § 3.4) : popup (24 h / 7 j / 30 j / Tout) et tableau de bord
 * (7 j / 30 j / 90 j / Tout). Fonctions pures, testées dans stats.test.ts.
 */

import { DAY, daysBefore } from '@/shared/utils/time';

export type Period = '24h' | '7d' | '30d' | '90d' | 'all';
export const POPUP_PERIODS = ['24h', '7d', '30d', 'all'] as const satisfies readonly Period[];
export const DASHBOARD_PERIODS = ['7d', '30d', '90d', 'all'] as const satisfies readonly Period[];
export type PopupPeriod = (typeof POPUP_PERIODS)[number];
export type DashboardPeriod = (typeof DASHBOARD_PERIODS)[number];

const DAYS: Record<Exclude<Period, 'all' | '24h'>, number> = { '7d': 7, '30d': 30, '90d': 90 };

/**
 * Début d'une période. 24 h : glissant (maintenant moins 24 h) ; 7, 30, 90 jours : depuis minuit,
 * aujourd'hui compris ; Tout : depuis la référence du compte. Jamais avant la référence : avant,
 * xGhost n'a pas de données.
 */
export function periodStart(period: Period, now: number, baselineAt?: number): number {
  if (period === 'all') return baselineAt ?? now;
  return Math.max(period === '24h' ? now - DAY : daysBefore(now, DAYS[period] - 1), baselineAt ?? 0);
}

/**
 * Granularité des graphes selon la durée réellement couverte (§ 3.4) : arrivées et départs par
 * jour jusqu'à un mois, par semaine au-delà ; solde net par semaine jusqu'à environ quatre mois,
 * par mois au-delà. Une période « Tout » encore courte garde donc le détail.
 */
export const activityUnit = (from: number, now: number): 'day' | 'week' => (now - from <= 31 * DAY ? 'day' : 'week');
export const netUnit = (from: number, now: number): 'week' | 'month' => (now - from <= 120 * DAY ? 'week' : 'month');
