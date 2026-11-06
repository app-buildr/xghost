import { isRecord } from '@/shared/utils/guards';
import { DASHBOARD_CHARTS, type DashboardChart, type Frequency, type Settings } from '@/shared/types';
import { FREQUENCIES } from './model';

/** Ne garde que les réglages connus, avec le bon type (toute autre valeur est ignorée). */
export function sanitizeSettings(raw: unknown): Partial<Settings> {
  const clean: Partial<Settings> = {};
  if (!isRecord(raw)) return clean;
  const patch = raw;
  if (FREQUENCIES.includes(patch.frequencyHours as Frequency)) clean.frequencyHours = patch.frequencyHours as Frequency;
  for (const key of ['badge', 'notifications'] as const) {
    const value = patch[key];
    if (typeof value === 'boolean') clean[key] = value;
  }
  if (Array.isArray(patch.hiddenCharts)) {
    clean.hiddenCharts = DASHBOARD_CHARTS.filter((c) => (patch.hiddenCharts as unknown[]).includes(c as DashboardChart));
  }
  return clean;
}
