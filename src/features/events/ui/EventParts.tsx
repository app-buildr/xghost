import { LOCALE, t } from '@/shared/i18n';
import { ExternalLink } from '@/shared/ui/ExternalLink';
import { formatAgo, formatAgoShort } from '@/shared/utils/format';
import { profileUrl } from '@/shared/x-urls';

/** Date d'un mouvement (forme courte dans la popup), avec la date complète au survol. */
export function EventTime({
  at,
  now,
  short = false,
  className,
}: {
  at: number;
  now: number;
  short?: boolean;
  className?: string;
}) {
  const date = new Date(at);
  if (!Number.isFinite(at)) return null;
  return (
    <time
      className={className}
      dateTime={date.toISOString()}
      title={t('common.event.detectedAt', { date: date.toLocaleString(LOCALE) })}
    >
      {short ? formatAgoShort(at, now) : formatAgo(at, now)}
    </time>
  );
}

/** Bouton « Voir le profil », avec le @handle dans le nom accessible (un libellé distinct par ligne). */
export function ProfileLink({ handle }: { handle: string }) {
  return (
    <ExternalLink
      className="xg-btn xg-btn--secondary"
      href={profileUrl(handle)}
      aria-label={t('dashboard.row.viewProfileOf', { handle })}
    >
      {t('dashboard.row.viewProfile')}
    </ExternalLink>
  );
}
