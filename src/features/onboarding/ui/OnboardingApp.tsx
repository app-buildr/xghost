import { hasKnownHandle } from '@/features/accounts/repository';
import { useEffect, useRef, useState } from 'react';
import { useAccountData, useAppState } from '@/features/app-state/hooks';
import { remainingLabel } from '@/features/followers-sync/estimate';
import type { ScanProgress } from '@/features/followers-sync/repository';
import { pauseMessage, SCAN_TAB_HINT } from '@/features/scan-status/messages';
import { useNow } from '@/shared/hooks/useNow';
import { send } from '@/shared/messaging/client';
import type { Frequency } from '@/shared/types';
import { IconCheck } from '@/shared/ui/icons';
import { Logo, ProgressBar } from '@/shared/ui/primitives';
import { formatNumber, percentOf } from '@/shared/utils/format';
import './onboarding.css';

const FREQUENCIES: { value: Frequency; label: string }[] = [
  { value: 1, label: 'Toutes les heures' },
  { value: 6, label: 'Toutes les 6 h' },
  { value: 24, label: '1 fois par jour' },
];

/** Détecte la session X, en réessayant tant que l'utilisateur n'est pas connecté. */
function useSessionDetection() {
  const [session, setSession] = useState<{ loggedIn: boolean; accountId?: string; handle?: string }>();
  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      const res = await send('session:detect', undefined).catch(() => ({ loggedIn: false }));
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

/** Onboarding (§ 3.3) : session, scan initial, fréquence. */
export function OnboardingApp() {
  const app = useAppState();
  const now = useNow(5_000);
  const session = useSessionDetection();
  const account = app.accounts.find((a) => a.id === session?.accountId);
  const { data } = useAccountData(account?.id);
  const started = useRef(false);

  // Lance le scan de référence dès que le compte est connu.
  useEffect(() => {
    if (!account || account.baselineAt || started.current) return;
    started.current = true;
    void send('scan:start', {});
  }, [account]);

  const progress = data?.progress;
  const done = !!account?.baselineAt && !progress;
  const incomplete = !done && !progress && !!account?.lastScan && !account.lastScan.complete;
  const handle = account?.handle ?? session?.handle;

  return (
    <main className="xg-onb">
      <div className="xg-brand">
        <Logo size={56} />
        <span>xGhost</span>
      </div>
      <h1>On prend une photo de tes abonnés.</h1>
      <p className="xg-onb__lead">
        Ce premier scan sert de référence. Ensuite, xGhost compare régulièrement et te signale chaque départ. Tes données
        restent dans Chrome, synchronisées avec ton compte Chrome.
      </p>

      <ol className="xg-onb__steps">
        <li className={`xg-step${session?.loggedIn ? ' is-done' : ' is-current'}`}>
          <span className="xg-step__num">{session?.loggedIn ? <IconCheck size={18} /> : 1}</span>
          <div>
            <div className="xg-step__title">{session?.loggedIn ? 'Session X détectée' : 'Connexion à X'}</div>
            {session === undefined ? (
              <div className="xg-step__hint">Recherche de ta session X…</div>
            ) : session.loggedIn ? (
              <div className="xg-step__hint">
                {account && hasKnownHandle(account)
                  ? `Connecté en tant que @${handle}`
                  : 'Compte X détecté, lecture de ton @ en cours…'}
              </div>
            ) : (
              <div className="xg-step__hint">
                Connecte-toi à X puis reviens ici.{' '}
                <a href="https://x.com/login" target="_blank" rel="noreferrer">
                  Ouvrir x.com
                </a>
              </div>
            )}
          </div>
        </li>

        <li className={`xg-step${done ? ' is-done' : session?.loggedIn ? ' is-current' : ''}`}>
          <span className="xg-step__num">{done ? <IconCheck size={18} /> : 2}</span>
          <div className="xg-step__body">
            <div className="xg-step__row">
              <span className="xg-step__title">Scan initial des abonnés</span>
              {progress && (
                <span className="xg-step__count">
                  {formatNumber(progress.collected)}
                  {progress.expected > 0 ? ` / ${formatNumber(progress.expected)}` : ''}
                </span>
              )}
            </div>
            {done ? (
              <div className="xg-step__hint">
                Scan terminé : référence de {formatNumber(account?.lastScan?.scanned ?? account?.followersCount ?? 0)}{' '}
                abonnés enregistrée.
              </div>
            ) : progress && progress.kind !== 'quick' ? (
              <>
                <ProgressBar value={progress.collected} max={progress.expected || progress.collected + 1} />
                <div className="xg-step__hint">{scanHint(progress, now)}</div>
                {progress.pausedReason === 'needs-focus' && account && (
                  <div>
                    <button
                      type="button"
                      className="xg-btn xg-btn--secondary"
                      onClick={() => void send('scan:focus', { accountId: account.id })}
                    >
                      Afficher l’onglet x.com
                    </button>
                  </div>
                )}
              </>
            ) : incomplete && account?.lastScan ? (
              <>
                <ProgressBar value={account.lastScan.scanned} max={account.lastScan.detected || 1} />
                <div className="xg-step__hint">
                  Scan incomplet ({percentOf(account.lastScan.scanned, account.lastScan.detected, { emptyIsFull: true })} %) : l’onglet
                  x.com a été fermé ou la liste s’est arrêtée trop tôt. Les abonnés déjà récupérés sont gardés.
                </div>
                <div>
                  <button type="button" className="xg-btn xg-btn--primary" onClick={() => void send('scan:start', { full: true })}>
                    Continuer le scan
                  </button>
                </div>
              </>
            ) : session?.loggedIn ? (
              <div className="xg-step__hint">Démarrage du scan…</div>
            ) : null}
          </div>
        </li>

        <li className={`xg-step${session?.loggedIn ? ' is-current' : ''}`}>
          <span className="xg-step__num">3</span>
          <div className="xg-step__body">
            <div className="xg-step__title">À quelle fréquence vérifier ?</div>
            <div className="xg-step__hint">Plus c’est fréquent, plus tu sais vite. Modifiable plus tard.</div>
            <div className="xg-onb__freq" role="radiogroup" aria-label="Fréquence de vérification">
              {FREQUENCIES.map((f) => (
                <button
                  key={f.value}
                  type="button"
                  role="radio"
                  aria-checked={app.settings.frequencyHours === f.value}
                  onClick={() => void app.updateSettings({ frequencyHours: f.value })}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>
        </li>
      </ol>

      {/* Pas de bouton de sortie pendant le scan (§ 3.3) : la page se met à jour à la fin. */}
      <div className="xg-onb__cta">
        {done ? (
          <a className="xg-btn xg-btn--ink xg-btn--lg" href={chrome.runtime.getURL('/options.html')}>
            Voir mon tableau de bord
          </a>
        ) : null}
        <p>Tu peux continuer à utiliser Chrome normalement pendant le scan.</p>
      </div>
    </main>
  );
}

function scanHint(progress: ScanProgress, now: number): string {
  if (progress.status === 'paused') return pauseMessage(progress);
  const remaining = remainingLabel(progress, now);
  return `${remaining ? `${remaining}. ` : ''}${SCAN_TAB_HINT}`;
}
