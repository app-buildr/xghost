import type { ComponentProps, ReactNode } from 'react';
import type { FollowEvent, ProfileCache } from '@/shared/types';
import { t } from '@/shared/i18n';
import { Avatar } from '@/shared/ui/primitives';
import { EventTime } from './EventParts';
import { displayName } from './display';
import './events.css';

/** Attributs posés par une liste virtualisée sur l'élément de la ligne (mesure, position). */
export type EventRowProps = Pick<ComponentProps<'li'>, 'ref' | 'aria-posinset' | 'aria-setsize'> & {
  'data-index': number;
};

/**
 * Ligne d'un mouvement (départ ou arrivée) : avatar, nom, étiquette « Nouveau », détails, date.
 * `full` (page d'options) : date en colonne et zone d'actions ; `compact` (popup) : point « nouveau ».
 */
export function EventRow({
  event,
  profiles,
  now,
  meta,
  variant = 'full',
  newTone = 'new',
  actions,
  rowProps,
}: {
  event: FollowEvent;
  profiles: ProfileCache | undefined;
  now: number;
  meta: string;
  variant?: 'full' | 'compact';
  /** Couleur de l'étiquette « Nouveau » : corail (départ) ou teal (arrivée). */
  newTone?: 'new' | 'follow';
  actions?: ReactNode;
  rowProps?: EventRowProps;
}) {
  const inactive = event.status !== 'active';
  const fresh = !event.seen;
  const name = displayName(event, profiles);
  const avatar = (
    <Avatar
      id={event.profileId}
      name={name}
      src={profiles?.[event.profileId]?.avatar}
      size={variant === 'compact' ? 44 : 48}
      muted={inactive}
    />
  );

  if (variant === 'compact') {
    return (
      <li data-id={event.id} className={`xg-dep-compact${inactive ? ' is-inactive' : ''}`}>
        {avatar}
        <div className="xg-dep__body">
          <div className="xg-dep__name">{name}</div>
          <div className="xg-dep__meta">{meta}</div>
        </div>
        <div className="xg-dep-compact__side">
          {fresh && (
            <span className="xg-dot" role="img" aria-label={t('dashboard.row.new')} />
          )}
          <EventTime at={event.at} now={now} short />
        </div>
      </li>
    );
  }

  return (
    <li {...rowProps} data-id={event.id} className={`xg-dep${inactive ? ' is-inactive' : ''}`}>
      {avatar}
      <div className="xg-dep__body">
        <div className="xg-dep__title">
          <span className="xg-dep__name">{name}</span>
          {fresh && <span className={`xg-tag xg-tag--${newTone}`}>{t('dashboard.row.new')}</span>}
        </div>
        <div className="xg-dep__meta">{meta}</div>
        {/* Panneau étroit (colonne des nouveaux abonnés) : la date passe sous le nom. */}
        <div className="xg-dep__date--inline">
          <EventTime className="xg-dep__date" at={event.at} now={now} />
        </div>
      </div>
      <div className="xg-dep__date--side">
        <EventTime className="xg-dep__date" at={event.at} now={now} />
      </div>
      {actions && <div className="xg-dep__actions">{actions}</div>}
    </li>
  );
}
