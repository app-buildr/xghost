import { t } from '@/shared/i18n';
import { Segmented } from '@/shared/ui/primitives';
import type { Period } from '../period';

/** Sélecteur de période des chiffres et des graphes. */
export function PeriodPicker<P extends Period>({
  periods,
  value,
  onChange,
}: {
  periods: readonly P[];
  value: P;
  onChange: (p: P) => void;
}) {
  return (
    <Segmented<P>
      label={t('stats.period.label')}
      value={value}
      onChange={onChange}
      options={periods.map((p) => ({ value: p, label: t(`stats.period.${p}`) }))}
    />
  );
}
