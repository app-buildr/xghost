import { localKv } from '@/shared/storage/kv';
import { keys } from '@/shared/storage/keys';
import type { GlobalStatus } from '@/shared/types';

/** État global (session X, compte connecté) : écrit par le service worker, lu par les interfaces. */
export const loadStatus = () => localKv.get<GlobalStatus>(keys.status);
export const saveStatus = (status: GlobalStatus) => localKv.set({ [keys.status]: status });
