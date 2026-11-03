import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { send } from '@/shared/messaging/client';
import type { FollowEvent } from '@/shared/types';

/**
 * « Vu à l'affichage » : un événement non vu devient vu quand il est réellement affiché
 * (ligne rendue dans une liste, page visible) ; le badge s'efface pour lui seul. Il garde
 * l'étiquette « Nouveau » tant que la page reste affichée ; quand on la quitte (autre
 * onglet, popup fermée) puis qu'on revient, il n'est plus nouveau.
 */
export function useSeenOnView(accountId: string | undefined, stored: FollowEvent[] | undefined) {
  // Affichés pendant cette visite alors qu'ils étaient non vus : gardent « Nouveau ».
  const [fresh, setFresh] = useState<ReadonlySet<string>>(new Set());
  // Ids affichés par les listes (en attente tant que la page est cachée).
  const [displayed, setDisplayed] = useState<ReadonlySet<string>>(new Set());
  const [visible, setVisible] = useState(() => document.visibilityState === 'visible');
  const sent = useRef(new Set<string>());

  useEffect(() => {
    const onVisibility = () => {
      const v = document.visibilityState === 'visible';
      setVisible(v);
      if (!v) setFresh(new Set()); // page quittée : plus rien n'est « nouveau » au retour
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    setFresh(new Set());
    setDisplayed(new Set());
    sent.current = new Set();
  }, [accountId]);

  const markDisplayed = useCallback((ids: readonly string[]) => {
    setDisplayed((prev) => (ids.every((id) => prev.has(id)) ? prev : new Set([...prev, ...ids])));
  }, []);

  useEffect(() => {
    if (!accountId || !visible || !stored || displayed.size === 0) return;
    const unseen = stored.filter((e) => !e.seen && displayed.has(e.id) && !sent.current.has(e.id)).map((e) => e.id);
    if (unseen.length === 0) return;
    unseen.forEach((id) => sent.current.add(id));
    setFresh((prev) => new Set([...prev, ...unseen]));
    void send('events:mark-seen', { accountId, eventIds: unseen }).catch(() => undefined);
  }, [accountId, visible, stored, displayed]);

  return { fresh, markDisplayed };
}

/** Signalement des lignes affichées, fourni par la page (popup, options) ; sans effet ailleurs. */
export const DisplayedContext = createContext<(ids: readonly string[]) => void>(() => undefined);

/** À appeler par une liste avec les événements qu'elle affiche réellement. */
export function useMarkDisplayed(events: readonly FollowEvent[]) {
  const markDisplayed = useContext(DisplayedContext);
  const key = events.map((e) => e.id).join(',');
  useEffect(() => {
    if (key) markDisplayed(key.split(','));
  }, [key, markDisplayed]);
}
