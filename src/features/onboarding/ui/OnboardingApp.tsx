import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ENTRY_FOLLOWER_LIMIT } from '@/domain/accounts/limit';
import { hasKnownHandle } from '@/domain/accounts/model';
import '@/features/accounts/ui/accounts.css';
import { useBackupImport } from '@/features/backup/ui/useBackupImport';
import { useAccountData } from '@/features/app-state/useAccountData';
import { useAppState } from '@/features/app-state/useAppState';
import { remainingLabel } from '@/features/followers-sync/estimate';
import type { ScanProgress } from '@/features/followers-sync/model';
import { pauseMessage, scanTabHint } from '@/features/scan-status/messages';
import { scanCoverage } from '@/features/scan-status/progress';
import { LastScanBar, ScanProgressBar } from '@/features/scan-status/ui/ScanProgressBar';
import { ContinueScanButton } from '@/features/scan-status/ui/ContinueScanButton';
import { ShowScanTabButton } from '@/features/scan-status/ui/ShowScanTabButton';
import { useStartScan } from '@/features/scan-status/ui/useStartScan';
import { frequencyOptions } from '@/features/settings/model';
import { useNow } from '@/shared/hooks/useNow';
import { t } from '@/shared/i18n';
import { send } from '@/shared/messaging/client';
import type { Frequency, TrackedAccount } from '@/shared/types';
import { ExternalLink } from '@/shared/ui/ExternalLink';
import { Check, RefreshCw, TriangleAlert, Upload, X } from 'lucide-react';
import { Brand, Segmented } from '@/shared/ui/primitives';
import { formatNumber, formatPercent, formatProgressCount } from '@/shared/utils/format';
import { X_LOGIN_URL } from '@/shared/x-urls';
import './onboarding.css';
import { SECOND } from '@/shared/utils/time';

/** Détecte la session X, en réessayant tant que l'utilisateur n'est pas connecté. */
function useSessionDetection() {
  const [session, setSession] = useState<{ loggedIn: boolean; accountId?: string; handle?: string }>();
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const res = await send('session:detect', { explicit: true }).catch(() => ({ loggedIn: false }));
      if (!alive) return;
      setSession(res);
      if (!res.loggedIn) timer = setTimeout(poll, 3000);
    };
    void poll();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);
  return session;
}

/** Texte sous la barre pendant le scan initial : pause, ou temps restant et consigne de l'onglet. */
function scanHint(progress: ScanProgress, now: number): string {
  if (progress.status === 'paused') return pauseMessage(progress);
  const remaining = remainingLabel(progress, now);
  return remaining ? t('common.scanStatus.hintWithRemaining', { hint: scanTabHint(), remaining }) : scanTabHint();
}

/**
 * Écran de la limite d'abonnés (§ 4.9) : le compte connecté dépasse la limite avant toute
 * synchronisation. Ni choix de démarrage, ni fréquence : la session est détectée, la
 * synchronisation barrée, et l'utilisateur peut désinstaller xGhost ou se connecter à un autre compte.
 */
function FollowerLimitScreen({ account, handle }: { account: TrackedAccount; handle?: string }) {
  const limit = formatNumber(ENTRY_FOLLOWER_LIMIT);
  const count = account.limit?.count ?? account.followersCount ?? 0;
  return (
    <main className="xg-onb">
      <Brand logoSize={56} />
      <h1>{t('onboarding.limit.title')}</h1>

      <div className="xg-limit xg-onb__limit" role="alert">
        <strong className="xg-limit__title">
          <TriangleAlert size={22} aria-hidden="true" />
          {t('onboarding.limit.alertTitle', { handle, n: formatNumber(count) })}
        </strong>
        <p>{t('onboarding.limit.alertText', { limit })}</p>
      </div>

      <ol className="xg-boxlist xg-onb__steps">
        <Step state="done" marker={<Check size={18} />}>
          <div className="xg-step__title">{t('onboarding.session.detected')}</div>
          <div className="xg-step__hint">{t('onboarding.session.loggedInAs', { handle })}</div>
        </Step>
        <Step state="blocked" marker={<X size={18} />}>
          <div className="xg-step__title">{t('onboarding.scan.title')}</div>
          <div className="xg-step__hint">{t('onboarding.limit.unavailable', { limit })}</div>
        </Step>
      </ol>

      <div className="xg-onb__cta xg-onb__cta--limit">
        <button
          type="button"
          className="xg-btn xg-btn--danger xg-btn--lg"
          onClick={() => void chrome.management.uninstallSelf({ showConfirmDialog: true }).catch(() => undefined)}
        >
          {t('onboarding.limit.uninstall')}
        </button>
        <p>{t('onboarding.limit.otherAccount', { limit })}</p>
      </div>
    </main>
  );
}

/** Étape de l'écran de démarrage : pastille (numéro ou icône) et contenu. */
function Step({
  state,
  marker,
  body = false,
  children,
}: {
  state?: 'done' | 'current' | 'blocked';
  marker: ReactNode;
  /** Le contenu prend toute la largeur, en colonne. */
  body?: boolean;
  children: ReactNode;
}) {
  return (
    <li className={`xg-step${state ? ` is-${state}` : ''}`}>
      <span className="xg-step__num">{marker}</span>
      <div className={body ? 'xg-step__body' : undefined}>{children}</div>
    </li>
  );
}

/** Délai avant la redirection vers le tableau de bord, le temps de lire « terminé ». */
const REDIRECT_MS = 2 * SECOND;
const DASHBOARD_URL = () => chrome.runtime.getURL('/options.html');

/**
 * Onboarding (§ 3.3) : session X, choix du démarrage (nouvelle synchronisation ou sauvegarde),
 * fréquence. Rien ne part vers X avant ce choix. Une sauvegarde importée mène directement au
 * tableau de bord ; une synchronisation terminée y redirige après un court délai (le bouton reste
 * affiché si la redirection n'a pas lieu).
 */
export function OnboardingApp() {
  const app = useAppState();
  const now = useNow(5 * SECOND);
  const session = useSessionDetection();
  const account = app.accounts.find((a) => a.id === session?.accountId);
  const { data } = useAccountData(account?.id);
  const { start, busy } = useStartScan(account?.id);
  const backup = useBackupImport();
  const fileInput = useRef<HTMLInputElement>(null);
  const [stopping, setStopping] = useState(false);

  const progress = data?.progress;
  const scanning = !!progress && progress.kind !== 'quick';
  const synced = !!account?.baselineAt && !progress;
  const done = synced;
  const incomplete = !done && !progress && !!account?.lastScan && !account.lastScan.complete;
  const handle = account?.handle ?? session?.handle;
  const doneCount = account?.lastScan?.scanned ?? account?.followersCount ?? 0;

  // Synchronisation terminée : direction le tableau de bord, le temps de lire « terminé ».
  useEffect(() => {
    if (!done) return;
    const timer = setTimeout(() => location.assign(DASHBOARD_URL()), REDIRECT_MS);
    return () => clearTimeout(timer);
  }, [done]);

  const restore = async (file: File | undefined) => {
    const picked = await backup.readFile(file);
    if (!picked) return;
    // Sauvegarde importée : rien à montrer ici, direction le tableau de bord.
    if ((await backup.importBackup(picked)) !== undefined) location.assign(DASHBOARD_URL());
  };

  const stop = async () => {
    if (!account) return;
    setStopping(true);
    try {
      await send('scan:stop', { accountId: account.id });
    } finally {
      setStopping(false);
    }
  };

  // Compte au-delà de la limite d'abonnés (§ 4.9) : aucune synchronisation possible.
  if (account?.limit && !account.baselineAt) {
    return <FollowerLimitScreen account={account} handle={handle} />;
  }

  const step2Title = done
    ? t('onboarding.scan.doneTitle')
    : scanning || incomplete
      ? t('onboarding.scan.title')
      : t('onboarding.choice.title');

  return (
    <main className="xg-onb">
      <Brand logoSize={56} />
      <h1>{t('onboarding.title')}</h1>
      <p className="xg-onb__lead">{t('onboarding.lead')}</p>

      <ol className="xg-boxlist xg-onb__steps">
        <Step state={session?.loggedIn ? 'done' : 'current'} marker={session?.loggedIn ? <Check size={18} /> : 1}>
            <div className="xg-step__title">
              {session?.loggedIn ? t('onboarding.session.detected') : t('onboarding.session.connect')}
            </div>
            {session === undefined ? (
              <div className="xg-step__hint">{t('onboarding.session.searching')}</div>
            ) : session.loggedIn ? (
              <div className="xg-step__hint">
                {account && hasKnownHandle(account)
                  ? t('onboarding.session.loggedInAs', { handle })
                  : t('onboarding.session.readingHandle')}
              </div>
            ) : (
              <div className="xg-step__hint">
                {t('onboarding.session.loginThenBack')}{' '}
                <ExternalLink href={X_LOGIN_URL}>{t('common.openX')}</ExternalLink>
              </div>
            )}
        </Step>

        <Step state={done ? 'done' : session?.loggedIn ? 'current' : undefined} marker={done ? <Check size={18} /> : 2} body>
            <div className="xg-step__row">
              <span className="xg-step__title">{step2Title}</span>
              {scanning && progress && (
                <span className="xg-step__count">{formatProgressCount(progress.collected, progress.expected)}</span>
              )}
            </div>
            {synced ? (
              <div className="xg-step__hint">
                {t('onboarding.scan.done', { count: doneCount, n: formatNumber(doneCount) })}
              </div>
            ) : scanning && progress ? (
              <>
                <ScanProgressBar progress={progress} />
                <div className="xg-step__hint">{scanHint(progress, now)}</div>
                <div className="xg-onb__actions">
                  {progress.pausedReason === 'needs-focus' && account && <ShowScanTabButton accountId={account.id} />}
                  <button type="button" className="xg-btn xg-btn--secondary" disabled={stopping} onClick={() => void stop()}>
                    {t('onboarding.scan.stop')}
                  </button>
                </div>
              </>
            ) : incomplete && account?.lastScan ? (
              <>
                <LastScanBar scan={account.lastScan} label={t('onboarding.scan.title')} />
                <div className="xg-step__hint">
                  {t('onboarding.scan.incomplete', { pct: formatPercent(scanCoverage(account.lastScan)) })}
                </div>
                <div className="xg-onb__actions">
                  <ContinueScanButton accountId={account.id} />
                  <button type="button" className="xg-btn xg-btn--secondary" disabled={stopping} onClick={() => void stop()}>
                    {t('onboarding.scan.stop')}
                  </button>
                </div>
              </>
            ) : session?.loggedIn ? (
              <>
                <div className="xg-step__hint">{t('onboarding.choice.hint')}</div>
                <div className="xg-onb__choices">
                  <section className="xg-onb__choice">
                    <h2>
                      <RefreshCw size={20} /> {t('onboarding.choice.syncTitle')}
                    </h2>
                    <p>{t('onboarding.choice.syncText')}</p>
                    <button
                      type="button"
                      className="xg-btn xg-btn--primary"
                      disabled={busy || backup.busy || !account}
                      onClick={() => void start({ announce: false })}
                    >
                      {t('onboarding.choice.syncButton')}
                    </button>
                  </section>
                  <section className="xg-onb__choice">
                    <h2>
                      <Upload size={20} /> {t('onboarding.choice.restoreTitle')}
                    </h2>
                    <p>{t('onboarding.choice.restoreText')}</p>
                    <button
                      type="button"
                      className="xg-btn xg-btn--secondary"
                      disabled={busy || backup.busy || stopping}
                      onClick={() => fileInput.current?.click()}
                    >
                      {t('backup.import')}
                    </button>
                    <input
                      ref={fileInput}
                      type="file"
                      accept="application/json,.json"
                      hidden
                      onChange={(e) => {
                        void restore(e.target.files?.[0]);
                        e.target.value = ''; // permet de choisir à nouveau le même fichier
                      }}
                    />
                  </section>
                </div>
              </>
            ) : null}
        </Step>

        <Step state={session?.loggedIn ? 'current' : undefined} marker={3} body>
            <div className="xg-step__title">{t('onboarding.frequency.title')}</div>
            <div className="xg-step__hint">{t('onboarding.frequency.hint')}</div>
            <Segmented<Frequency>
              className="xg-onb__freq"
              label={t('common.frequency.label')}
              options={frequencyOptions('long')}
              value={app.settings.frequencyHours}
              onChange={(frequencyHours) => void app.updateSettings({ frequencyHours })}
            />
        </Step>
      </ol>

      <div className="xg-onb__cta">
        {done && (
          <a className="xg-btn xg-btn--ink xg-btn--lg" href={DASHBOARD_URL()}>
            {t('onboarding.dashboard')}
          </a>
        )}
        {scanning && <p>{t('onboarding.keepBrowsing')}</p>}
      </div>
    </main>
  );
}
