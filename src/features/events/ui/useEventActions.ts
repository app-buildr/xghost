import { useCallback } from 'react';
import { t } from '@/shared/i18n';
import { send } from '@/shared/messaging/client';
import type { FollowEvent } from '@/shared/types';
import { useToast } from '@/shared/ui/toast';

/** Actions sur les événements, avec toasts (copie, comptes ignorés, suppression annulable). */
export function useEventActions(accountId: string | undefined) {
  const toast = useToast();

  const copyUsername = useCallback(
    async (handle: string) => {
      try {
        await navigator.clipboard.writeText(`@${handle}`);
        toast.show(t('common.actions.copied', { handle }));
      } catch {
        toast.show(t('common.actions.copyFailed'));
      }
    },
    [toast],
  );

  const ignore = useCallback(
    async (profileId: string, handle: string, ignored = true) => {
      if (!accountId) return;
      try {
        await send('profile:ignore', { accountId, profileId, ignored });
        toast.show(ignored ? t('common.actions.ignored', { handle }) : t('common.actions.unignored', { handle }));
      } catch {
        toast.show(t('common.actions.failed'));
      }
    },
    [accountId, toast],
  );

  /** Retire un événement (message `take`), avec un toast « Annuler » qui le remet (message `undo`). */
  const takeWithUndo = useCallback(
    async (
      take: 'events:delete' | 'events:falseDeparture',
      undo: 'events:restore' | 'events:restoreFalseDeparture',
      event: FollowEvent,
      message: string,
      refused?: string,
    ) => {
      if (!accountId) return;
      try {
        const { removed } = await send(take, { accountId, eventId: event.id });
        if (!removed) {
          if (refused) toast.show(refused);
          return;
        }
        toast.show(message, {
          action: {
            label: t('common.actions.undo'),
            run: () => void send(undo, { accountId, event: removed }).catch(() => undefined),
          },
        });
      } catch {
        toast.show(t('common.actions.failed'));
      }
    },
    [accountId, toast],
  );

  const remove = useCallback(
    (event: FollowEvent) => takeWithUndo('events:delete', 'events:restore', event, t('common.actions.removed')),
    [takeWithUndo],
  );

  const falseDeparture = useCallback(
    (event: FollowEvent) =>
      takeWithUndo(
        'events:falseDeparture',
        'events:restoreFalseDeparture',
        event,
        t('common.actions.falseDeparture', { handle: event.handle }),
        t('common.actions.falseDepartureRefused', { handle: event.handle }),
      ),
    [takeWithUndo],
  );

  return { copyUsername, ignore, remove, falseDeparture };
}
