import { useEffect, useState } from 'react';
import { joinParts } from '@/features/events/ui/display';
import type { ScanProgress } from '@/features/followers-sync/repository';
import { ALARM_CHECK } from '@/features/scheduler/alarms';
import { t } from '@/shared/i18n';
import { DASHBOARD_PERIODS, type DashboardPeriod } from '@/features/stats/period';
import type { TrackedAccount } from '@/shared/types';
import { Segmented } from '@/shared/ui/primitives';
import { formatAgo, formatIn } from '@/shared/utils/format';
import { CheckNowButton } from './CheckNowButton';
import { quickSummary } from './quickSummary';
import './dashboard.css';

/** Heure de la prochaine vérification automatique (alarme relue chaque minute). */
function useNextCheck(): number | undefined {
  const [next, setNext] = useState<number>();
  useEffect(() => {
    const read = () => chrome.alarms.get(ALARM_CHECK).then((a) => setNext(a?.scheduledTime));
    void read();
    const timer = setInterval(read, 60_000);
    return () => clearInterval(timer);
  }, []);
  return next;
}

/** En-tête des sections du tableau de bord : dernière/prochaine vérification, résultat, « Vérifier ». */
export function DashboardHeader({
  account,
  progress,
  now,
  period,
}: {
  account: TrackedAccount;
  progress?: ScanProgress;
  now: number;
  /** Tableau de bord : sélecteur de période des chiffres et des graphes (§ 3.4). */
  period?: { value: DashboardPeriod; onChange: (p: DashboardPeriod) => void };
}) {
  const next = useNextCheck();
  const summary = quickSummary(account);
  return (
    <header className="xg-dash__header">
      <div className="xg-dash__heading">
        <h1>{t('dashboard.header.title')}</h1>
        <p className="xg-dash__sub">
          {joinParts([
            account.lastScanAt
              ? t('dashboard.header.lastCheck', { ago: formatAgo(account.lastScanAt, now) })
              : t('dashboard.header.neverChecked'),
            next && next > now ? t('dashboard.header.nextCheck', { in: formatIn(next, now) }) : undefined,
          ])}
        </p>
        {summary && <p className="xg-dash__result">{t('dashboard.header.lastQuick', { summary })}</p>}
      </div>
      <div className="xg-dash__actions">
        {period && (
          <Segmented<DashboardPeriod>
            label={t('stats.period.label')}
            value={period.value}
            onChange={period.onChange}
            options={DASHBOARD_PERIODS.map((p) => ({ value: p, label: t(`stats.period.${p}`) }))}
          />
        )}
        <CheckNowButton account={account} progress={progress} />
      </div>
    </header>
  );
}
