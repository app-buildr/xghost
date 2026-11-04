import { t } from '@/shared/i18n';
import type { Frequency } from '@/shared/types';

/** Fréquences de vérification proposées (réglages et onboarding). */
export const FREQUENCIES: readonly Frequency[] = [1, 6, 12, 24, 0];

/** Libellé d'une fréquence : court (« 6 h ») pour les réglages, long (« Toutes les 6 h ») pour l'onboarding. */
export function frequencyLabel(h: Frequency, style: 'short' | 'long' = 'short'): string {
  if (h === 0) return t('common.frequency.manual');
  if (style === 'short') return t('common.frequency.short', { h });
  if (h === 1) return t('common.frequency.hourly');
  if (h === 24) return t('common.frequency.daily');
  return t('common.frequency.everyHours', { h });
}

/** Options du sélecteur de fréquence. */
export const frequencyOptions = (style: 'short' | 'long' = 'short') =>
  FREQUENCIES.map((value) => ({ value, label: frequencyLabel(value, style) }));
