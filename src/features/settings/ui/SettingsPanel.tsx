import { send } from '@/shared/messaging/client';
import { t } from '@/shared/i18n';
import type { Frequency, Settings, TrackedAccount } from '@/shared/types';
import { Segmented, Toggle } from '@/shared/ui/primitives';
import { frequencyOptions } from '../model';
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
  return (
    <div className="xg-settings">
      <section className="xg-card">
        <h2 className="xg-card__title">{t('options.settings.check')}</h2>
        <div className="xg-setting__label">{t('options.settings.frequency')}</div>
        <Segmented<Frequency>
          label={t('common.frequency.label')}
          options={frequencyOptions('short')}
          value={settings.frequencyHours}
          onChange={(frequencyHours) => onUpdate({ frequencyHours })}
        />
      </section>

      <section className="xg-card">
        <h2 className="xg-card__title">{t('options.settings.alerts')}</h2>
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
      </section>
    </div>
  );
}
