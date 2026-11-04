import { useCallback, useEffect, useRef } from 'react';
import { send } from '@/shared/messaging/client';
import type { DashboardChart } from '@/shared/types';

/**
 * Affiche ou masque un graphique du tableau de bord (réglages et bouton « Cacher » des cartes).
 * Part de la dernière liste demandée : deux bascules coup sur coup ne s'écrasent pas (le réglage
 * enregistré ne revient qu'après l'aller-retour avec le service worker).
 */
export function useChartVisibility(hidden: readonly DashboardChart[]) {
  const latest = useRef(hidden);
  useEffect(() => {
    latest.current = hidden;
  }, [hidden]);
  return useCallback((chart: DashboardChart, shown: boolean) => {
    const current = latest.current;
    latest.current = shown ? current.filter((c) => c !== chart) : current.includes(chart) ? current : [...current, chart];
    void send('settings:update', { hiddenCharts: [...latest.current] }).catch(() => undefined);
  }, []);
}
