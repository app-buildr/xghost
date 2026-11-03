import { useMemo } from 'react';
import type { AccountData } from '@/features/app-state/hooks';
import { currentArrivals, type VisibilityContext } from '@/features/events/selectors';
import type { TrackedAccount } from '@/shared/types';
import { Avatar } from '@/shared/ui/primitives';
import { EventTime, ProfileLink } from './EventParts';
import { displayName } from './useDisplayProfiles';

/** « Nouveaux abonnés » : arrivées détectées depuis le scan de référence. */
export function ArrivalsPanel({
  account,
  data,
  ctx,
  now,
}: {
  account: TrackedAccount;
  data: AccountData;
  ctx: VisibilityContext;
  now: number;
}) {
  const list = useMemo(() => currentArrivals(data.events, ctx), [data.events, ctx]);

  return (
    <section className="xg-card xg-dep-panel" aria-label="Nouveaux abonnés">
      <div className="xg-dep-panel__head">
        <h2>Nouveaux abonnés</h2>
      </div>
      {list.length === 0 ? (
        <p className="xg-dep-panel__empty">Aucun nouvel abonné détecté depuis la référence.</p>
      ) : (
        <ul className="xg-dep-list">
          {list.map((e) => {
            const name = displayName(e, data.profiles);
            return (
              <li className="xg-dep" key={e.id}>
                <Avatar id={e.profileId} name={name} src={data.profiles[e.profileId]?.avatar} />
                <div className="xg-dep__body">
                  <div className="xg-dep__title">
                    <span className="xg-dep__name">{name}</span>
                    {!e.seen && <span className="xg-tag xg-tag--follow">Nouveau</span>}
                    {e.mutual && <span className="xg-tag xg-tag--follow">Tu le suis</span>}
                  </div>
                  <div className="xg-dep__meta">@{e.handle}</div>
                </div>
                <EventTime className="xg-dep__date" at={e.at} now={now} />
                <div className="xg-dep__actions">
                  <ProfileLink handle={e.handle} />
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
