import { describe, expect, it } from 'vitest';
import type { TrackedAccount } from '@/shared/types';
import { planCheck, type CheckOrigin } from './check-policy';

const NOW = 1_000_000_000_000;
const MINUTE = 60_000;
const base: TrackedAccount = { id: '1', handle: 'moi', addedAt: 1, mutualsOnly: false, baselineAt: 1 };

const plan = (origin: CheckOrigin, account: Partial<TrackedAccount> = {}, hasSnapshot = true) => {
  const full = { ...base, ...account };
  return planCheck({ origin, account: full, accounts: { '1': full }, hasSnapshot, now: NOW });
};

describe('planCheck', () => {
  it('« Vérifier maintenant » : contrôle léger', () => {
    expect(plan('user')).toEqual({ kind: 'quick', reason: 'quick', target: undefined });
  });
  it('« Scan complet » : scan de comparaison', () => {
    expect(plan('user-full')).toMatchObject({ kind: 'check', reason: 'user' });
  });
  it('sans référence : scan de référence', () => {
    expect(plan('user', {}, false).kind).toBe('baseline');
    expect(plan('user', { baselineAt: undefined }).kind).toBe('baseline');
  });
  it('un autre compte a sa référence : nouveau compte', () => {
    const other = { ...base, id: '2' };
    const account = { ...base, baselineAt: undefined };
    expect(planCheck({ origin: 'user', account, accounts: { '1': account, '2': other }, hasSnapshot: false, now: NOW }).reason).toBe('new-account');
  });
  it('dernier scan incomplet : continué', () => {
    const lastScan = { at: 1, detected: 10, scanned: 5, complete: false };
    expect(plan('schedule', { lastScan })).toMatchObject({ kind: 'check', reason: 'incomplete' });
  });
  it('scan de contrôle après 10 contrôles légers, jamais pour « Vérifier maintenant »', () => {
    expect(plan('schedule', { quickSinceFull: 10 })).toMatchObject({ kind: 'check', reason: 'safety' });
    expect(plan('schedule', { quickSinceFull: 9 }).kind).toBe('quick');
    expect(plan('user', { quickSinceFull: 10 }).kind).toBe('quick');
  });
  it('écart en attente : arrêt anticipé seulement si le contrôle a pu conclure', () => {
    expect(plan('followup', { pending: { count: 3, at: 1 } })).toMatchObject({ reason: 'missing', target: 3 });
    expect(plan('followup', { pending: { count: 3, at: 1, full: true } }).target).toBeUndefined();
    expect(plan('followup', { pending: { count: 0, at: 1, full: true } }).reason).toBe('overflow');
  });
  it('nouvel essai d’un résultat suspect', () => {
    expect(plan('retry')).toMatchObject({ kind: 'check', reason: 'recheck', target: undefined });
  });
  it('référence automatique : attente doublée à chaque essai, plafonnée', () => {
    const none = { baselineAt: undefined };
    expect(plan('auto', none).backoff).toEqual({ attempts: 1, at: NOW });
    expect(plan('auto', { ...none, baselineRetry: { attempts: 1, at: NOW - 10 * MINUTE } }).backoff).toBe('wait');
    expect(plan('auto', { ...none, baselineRetry: { attempts: 1, at: NOW - 16 * MINUTE } }).backoff).toEqual({ attempts: 2, at: NOW });
    expect(plan('auto', { ...none, baselineRetry: { attempts: 2, at: NOW - 16 * MINUTE } }).backoff).toBe('wait');
    expect(plan('auto', { ...none, baselineRetry: { attempts: 20, at: NOW - 13 * 60 * MINUTE } }).backoff).toEqual({ attempts: 21, at: NOW });
  });
  it('référence demandée par l’utilisateur : pas d’attente', () => {
    expect(plan('user', { baselineAt: undefined, baselineRetry: { attempts: 5, at: NOW } }).backoff).toBeUndefined();
  });
});
