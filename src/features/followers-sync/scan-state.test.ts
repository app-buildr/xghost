import { describe, expect, it } from 'vitest';
import type { ScanJob } from '@/shared/types';
import { decideStall, isStalled, mergePage, shouldPersist } from './scan-state';

const NOW = 1_000_000_000;
const SECOND = 1000;

const job = (over: Partial<ScanJob> = {}): ScanJob => ({
  accountId: '1',
  kind: 'check',
  status: 'running',
  startedAt: 0,
  updatedAt: 0,
  pages: 3,
  collected: {},
  expectedTotal: 100,
  lastProgressAt: NOW,
  ...over,
});

const idle = (seconds: number, over: Partial<ScanJob> = {}) => job({ lastProgressAt: NOW - seconds * SECOND, ...over });

describe('decideStall', () => {
  it('rien à faire tant que la liste avance', () => {
    expect(decideStall(idle(5), true, NOW)).toBe('none');
  });
  it('pause pour la limite de X : on attend', () => {
    expect(decideStall(idle(300, { status: 'paused', pausedReason: 'rate-limit' }), true, NOW)).toBe('none');
  });
  it('rien de lu : un passage par l’id du compte, une seule fois', () => {
    expect(decideStall(idle(25, { pages: 0 }), true, NOW)).toBe('lookup');
    expect(decideStall(idle(25, { pages: 0, totalLookupAt: 1 }), true, NOW)).toBe('retry');
  });
  it('chargement arrêté : un essai sur « Réessayer »', () => {
    expect(decideStall(idle(25), false, NOW)).toBe('retry');
  });
  it('x.com refuse toujours : pause comme pour une limite', () => {
    expect(decideStall(idle(61, { retriedAt: NOW, xError: true }), false, NOW)).toBe('rate-limit');
  });
  it('onglet caché sans réponse : demande de l’afficher, une fois', () => {
    expect(decideStall(idle(61, { retriedAt: NOW }), false, NOW)).toBe('needs-focus');
    expect(decideStall(idle(61, { retriedAt: NOW, pausedReason: 'needs-focus' }), false, NOW)).toBe('none');
  });
  it('onglet visible, toujours rien : liste terminée', () => {
    expect(decideStall(idle(61, { retriedAt: NOW }), true, NOW)).toBe('finish');
    expect(decideStall(idle(30, { retriedAt: NOW }), true, NOW)).toBe('none');
  });
});

describe('mergePage', () => {
  const page = (ids: string[], skipped = 0) => ({
    users: ids.map((id) => ({ id, handle: `u${id}`, name: id, following: false })),
    skipped,
    done: false,
  });

  it('compte chaque abonné une fois et garde l’ordre', () => {
    const scan = job({ pages: 0 });
    const read = new Set<string>();
    mergePage(scan, read, page(['1', '2']), NOW);
    mergePage(scan, read, page(['2', '3'], 1), NOW);
    expect(scan.count).toBe(3);
    expect(scan.top).toEqual(['1', '2', '3']);
    expect(scan.skipped).toBe(1);
    expect(scan.pages).toBe(2);
  });

  it('contrôle léger : ordre gardé dans la limite de la première page', () => {
    const scan = job({ kind: 'quick', pages: 0 });
    mergePage(scan, new Set(), page(Array.from({ length: 150 }, (_, i) => String(i))), NOW);
    expect(scan.top).toHaveLength(100);
    expect(scan.count).toBe(150);
  });

  it('une page reçue efface les erreurs en cours', () => {
    const scan = job({ failedPages: 2, failureCycles: 1, xError: true });
    mergePage(scan, new Set(), page([]), NOW);
    expect(scan).toMatchObject({ failedPages: undefined, failureCycles: undefined, xError: undefined, lastProgressAt: NOW });
  });
});

describe('isStalled', () => {
  it('sans page depuis 5 min : abandonné', () => {
    expect(isStalled(idle(301), NOW)).toBe(true);
    expect(isStalled(idle(299), NOW)).toBe(false);
  });
  it('pause avec échéance : on attend', () => {
    expect(isStalled(idle(301, { status: 'paused', pausedReason: 'rate-limit' }), NOW)).toBe(false);
  });
  it('pause en attente de l’utilisateur : compte comme bloqué', () => {
    expect(isStalled(idle(301, { status: 'paused', pausedReason: 'needs-focus' }), NOW)).toBe(true);
  });
});

describe('shouldPersist', () => {
  it('toutes les 5 pages, pas plus d’une fois par 30 s', () => {
    expect(shouldPersist(job({ pages: 5 }), undefined, NOW)).toBe(true);
    expect(shouldPersist(job({ pages: 6 }), undefined, NOW)).toBe(false);
    expect(shouldPersist(job({ pages: 5 }), NOW - 10 * SECOND, NOW)).toBe(false);
  });
  it('contrôle léger : toujours', () => {
    expect(shouldPersist(job({ kind: 'quick', pages: 1 }), NOW, NOW)).toBe(true);
  });
});
