import { NEW_ISSUE_URL, REPO_URL } from '@/features/updates/config';
import { installedVersion } from '@/features/updates/version';
import { t } from '@/shared/i18n';
import { ExternalLink } from '@/shared/ui/ExternalLink';

/** Pied de la page d'options : code source, signalement de bug (issue GitHub), version installée. */
export function OptionsFooter() {
  const version = installedVersion();
  // Issue préremplie : étiquette « bug », version et navigateur pour aider au diagnostic.
  const issue = `${NEW_ISSUE_URL}?${new URLSearchParams({
    labels: 'bug',
    body: t('options.footer.issueBody', { version, browser: navigator.userAgent }),
  })}`;
  return (
    <footer className="xg-options__footer">
      <nav className="xg-options__footer-links" aria-label={t('options.footer.label')}>
        <ExternalLink href={REPO_URL}>{t('options.footer.source')}</ExternalLink>
        <ExternalLink href={issue}>{t('options.footer.reportBug')}</ExternalLink>
      </nav>
      <span className="xg-options__version">{t('options.footer.version', { version })}</span>
    </footer>
  );
}
