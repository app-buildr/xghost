import { send } from '@/shared/messaging/client';
import type { Frequency, Settings, TrackedAccount } from '@/shared/types';
import { Segmented, Toggle } from '@/shared/ui/primitives';
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

export const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 1, label: '1 h' },
  { value: 6, label: '6 h' },
  { value: 12, label: '12 h' },
  { value: 24, label: '24 h' },
];

/** Colonne des réglages (§ 3.4) : vérification et alertes. Le bloc « Données » est hors périmètre. */
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
        <h2 className="xg-card__title">Vérification</h2>
        <div className="xg-setting__label">Fréquence</div>
        <Segmented<Frequency>
          label="Fréquence de vérification"
          options={FREQUENCIES}
          value={settings.frequencyHours}
          onChange={(frequencyHours) => onUpdate({ frequencyHours })}
        />
      </section>

      <section className="xg-card">
        <h2 className="xg-card__title">Alertes</h2>
        <Row
          title="Badge sur l’icône"
          hint="Nombre de départs non vus"
          checked={settings.badge}
          onChange={(badge) => onUpdate({ badge })}
        />
        <Row
          title="Notification système"
          hint="Une notif Chrome à chaque vérification avec départs"
          checked={settings.notifications}
          onChange={(notifications) => onUpdate({ notifications })}
        />
        <Row
          title="Uniquement les mutuels"
          hint={account ? `Alerter seulement si je le suivais (@${account.handle})` : 'Alerter seulement si je le suivais'}
          checked={account?.mutualsOnly ?? false}
          disabled={!account}
          onChange={(mutualsOnly) => account && void send('account:update', { accountId: account.id, mutualsOnly })}
        />
        <Row
          title="Ignorer les comptes suspendus"
          hint="Ce n’est pas un vrai unfollow"
          checked={settings.ignoreSuspended}
          onChange={(ignoreSuspended) => onUpdate({ ignoreSuspended })}
        />
      </section>
    </div>
  );
}
