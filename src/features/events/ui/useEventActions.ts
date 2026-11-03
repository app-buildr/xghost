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

  const remove = useCallback(
    async (event: FollowEvent) => {
      if (!accountId) return;
      try {
        const { removed } = await send('events:delete', { accountId, eventId: event.id });
        if (!removed) return;
        toast.show(t('common.actions.removed'), {
          action: {
            label: t('common.actions.undo'),
            run: () => void send('events:restore', { accountId, event: removed }).catch(() => undefined),
          },
        });
      } catch {
        toast.show(t('common.actions.failed'));
      }
    },
    [accountId, toast],
  );

  return { copyUsername, ignore, remove };
}
