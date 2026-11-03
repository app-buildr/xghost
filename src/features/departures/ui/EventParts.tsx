import { formatAgo, formatAgoShort } from '@/shared/utils/format';

/** Date d'un mouvement (forme courte dans la popup), avec la date complète au survol. */
export function EventTime({ at, now, short = false, className }: { at: number; now: number; short?: boolean; className?: string }) {
  return (
    <time className={className} dateTime={new Date(at).toISOString()} title={`Détecté le ${new Date(at).toLocaleString('fr-FR')}`}>
      {short ? formatAgoShort(at, now) : formatAgo(at, now)}
    </time>
  );
}

/** Bouton « Voir le profil » (le @handle est validé à la lecture des réponses de X). */
export function ProfileLink({ handle }: { handle: string }) {
  return (
    <a className="xg-btn xg-btn--secondary" href={`https://x.com/${handle}`} target="_blank" rel="noreferrer">
      Voir le profil
    </a>
  );
}
