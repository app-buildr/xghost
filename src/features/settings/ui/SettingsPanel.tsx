import { send } from '@/shared/messaging/client';
import { t } from '@/shared/i18n';
import { DASHBOARD_CHARTS, type Frequency, type Settings, type TrackedAccount } from '@/shared/types';
import { RETENTION_DAYS } from '@/features/stats/selectors';
import { Card, Segmented, Toggle } from '@/shared/ui/primitives';
import { formatList } from '@/shared/utils/format';
import { frequencyOptions } from '../model';
import { useChartVisibility } from '../useChartVisibility';
import './settings.css';

function Row({
  title,
  hint,
  checked,
  onChange,
  disabled,
}: {
  title: string;
  hint: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className="xg-setting">
      <div>
        <div className="xg-setting__title">{title}</div>
        <div className="xg-setting__hint">{hint}</div>
      </div>
      <Toggle checked={checked} onChange={onChange} label={title} disabled={disabled} />
    </div>
  );
}

/** Colonne des réglages (§ 3.4) : vérification et alertes. */
export function SettingsPanel({
  settings,
  account,
  onUpdate,
}: {
  settings: Settings;
  account?: TrackedAccount;
  onUpdate: (patch: Partial<Settings>) => void;
}) {
  const setChartShown = useChartVisibility(settings.hiddenCharts);
  return (
    <div className="xg-settings">
      <Card title={t('options.settings.check')}>
        <div className="xg-setting__label">{t('options.settings.frequency')}</div>
        <Segmented<Frequency>
          label={t('common.frequency.label')}
          options={frequencyOptions('short')}
          value={settings.frequencyHours}
          onChange={(frequencyHours) => onUpdate({ frequencyHours })}
        />
      </Card>

      <Card title={t('options.settings.charts')}>
        {DASHBOARD_CHARTS.map((chart) => (
          <Row
            key={chart}
            title={t(`options.settings.chart.${chart}`)}
            hint={t(`options.settings.chart.${chart}Hint`, { days: formatList(RETENTION_DAYS.map(String)) })}
            checked={!settings.hiddenCharts.includes(chart)}
            onChange={(shown) => setChartShown(chart, shown)}
          />
        ))}
      </Card>

      <Card title={t('options.settings.alerts')}>
        <Row
          title={t('options.settings.badge')}
          hint={t('options.settings.badgeHint')}
          checked={settings.badge}
          onChange={(badge) => onUpdate({ badge })}
        />
        <Row
          title={t('options.settings.notifications')}
          hint={t('options.settings.notificationsHint')}
          checked={settings.notifications}
          onChange={(notifications) => onUpdate({ notifications })}
        />
        <Row
          title={t('options.settings.mutualsOnly')}
          hint={
            account
              ? t('options.settings.mutualsOnlyHintAccount', { handle: account.handle })
              : t('options.settings.mutualsOnlyHint')
          }
          checked={account?.mutualsOnly ?? false}
          disabled={!account}
          onChange={(mutualsOnly) =>
            account && void send('account:update', { accountId: account.id, mutualsOnly }).catch(() => undefined)
          }
        />
      </Card>
    </div>
  );
}
