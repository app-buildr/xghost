import type { Envelope, Reply, RequestType, Requests } from './protocol';

/** Envoie une requête typée au service worker. */
export async function send<K extends RequestType>(type: K, payload: Requests[K]['req']): Promise<Requests[K]['res']> {
  const envelope: Envelope<K> = { xg: type, payload };
  const reply = (await chrome.runtime.sendMessage(envelope)) as Reply<K> | undefined;
  if (!reply) throw new Error('Pas de réponse du service worker');
  if (!reply.ok) throw new Error(reply.error);
  return reply.data;
}
