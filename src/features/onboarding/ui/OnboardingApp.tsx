import { useEffect, useRef, useState } from 'react';
import { ENTRY_FOLLOWER_LIMIT } from '@/features/accounts/limit';
import { hasKnownHandle } from '@/features/accounts/model';
import '@/features/accounts/ui/accounts.css';
import { useBackupImport } from '@/features/backup/ui/useBackupImport';
import { useAccountData } from '@/features/app-state/useAccountData';
import { useAppState } from '@/features/app-state/useAppState';
import { remainingLabel } from '@/features/followers-sync/estimate';
import type { ScanProgress } from '@/features/followers-sync/model';
import { pauseMessage, scanTabHint } from '@/features/scan-status/messages';
import { scanCoverage } from '@/features/scan-status/progress';
import { LastScanBar, ScanProgressBar } from '@/features/scan-status/ui/ScanProgressBar';
import { ShowScanTabButton } from '@/features/scan-status/ui/ShowScanTabButton';
import { useStartScan } from '@/features/scan-status/ui/useStartScan';
import { frequencyOptions } from '@/features/settings/model';
import { useNow } from '@/shared/hooks/useNow';
import { t } from '@/shared/i18n';
import { send } from '@/shared/messaging/client';
import type { Frequency, TrackedAccount } from '@/shared/types';
import { ExternalLink } from '@/shared/ui/ExternalLink';
import { Check, RefreshCw, TriangleAlert, Upload, X } from 'lucide-react';
import { Logo, Segmented } from '@/shared/ui/primitives';
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
      <div className="xg-brand">
        <Logo size={56} />
        <span>{t('common.appName')}</span>
      </div>
      <h1>{t('onboarding.limit.title')}</h1>

      <div className="xg-limit xg-onb__limit" role="alert">
        <strong className="xg-limit__title">
          <TriangleAlert size={22} aria-hidden="true" />
          {t('onboarding.limit.alertTitle', { handle, n: formatNumber(count) })}
        </strong>
        <p>{t('onboarding.limit.alertText', { limit })}</p>
      </div>

      <ol className="xg-boxlist xg-onb__steps">
        <li className="xg-step is-done">
          <span className="xg-step__num">
            <Check size={18} />
          </span>
          <div>
            <div className="xg-step__title">{t('onboarding.session.detected')}</div>
            <div className="xg-step__hint">{t('onboarding.session.loggedInAs', { handle })}</div>
          </div>
        </li>
        <li className="xg-step is-blocked">
          <span className="xg-step__num">
            <X size={18} />
          </span>
          <div>
            <div className="xg-step__title">{t('onboarding.scan.title')}</div>
            <div className="xg-step__hint">{t('onboarding.limit.unavailable', { limit })}</div>
          </div>
        </li>
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
  const { start, busy } = useStartScan();
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
      <div className="xg-brand">
        <Logo size={56} />
        <span>{t('common.appName')}</span>
      </div>
      <h1>{t('onboarding.title')}</h1>
      <p className="xg-onb__lead">{t('onboarding.lead')}</p>

      <ol className="xg-boxlist xg-onb__steps">
        <li className={`xg-step${session?.loggedIn ? ' is-done' : ' is-current'}`}>
          <span className="xg-step__num">{session?.loggedIn ? <Check size={18} /> : 1}</span>
          <div>
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
          </div>
        </li>

        <li className={`xg-step${done ? ' is-done' : session?.loggedIn ? ' is-current' : ''}`}>
          <span className="xg-step__num">{done ? <Check size={18} /> : 2}</span>
          <div className="xg-step__body">
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
                  <button
                    type="button"
                    className="xg-btn xg-btn--primary"
                    disabled={busy}
                    onClick={() => void start({ full: true, announce: false })}
                  >
                    {t('common.continueScan')}
                  </button>
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
                    <h3>
                      <RefreshCw size={20} /> {t('onboarding.choice.syncTitle')}
                    </h3>
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
                    <h3>
                      <Upload size={20} /> {t('onboarding.choice.restoreTitle')}
                    </h3>
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
          </div>
        </li>

        <li className={`xg-step${session?.loggedIn ? ' is-current' : ''}`}>
          <span className="xg-step__num">3</span>
          <div className="xg-step__body">
            <div className="xg-step__title">{t('onboarding.frequency.title')}</div>
            <div className="xg-step__hint">{t('onboarding.frequency.hint')}</div>
            <Segmented<Frequency>
              className="xg-onb__freq"
              label={t('common.frequency.label')}
              options={frequencyOptions('long')}
              value={app.settings.frequencyHours}
              onChange={(frequencyHours) => void app.updateSettings({ frequencyHours })}
            />
          </div>
        </li>
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
