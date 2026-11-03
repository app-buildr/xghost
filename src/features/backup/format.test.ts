import { describe, expect, it } from 'vitest';
import { compactEventsOf, decodeEvent, isCompactEvent } from '@/features/events/codec';
import { backupItems, isBackupKey, isTransientKey, validateBackup } from './format';

const NOW_S = 1_762_000_000; // nov. 2025, en secondes
const event = (over: Partial<Record<number, unknown>> = {}) => {
  const e: unknown[] = [0, '123', 'marie_codes', NOW_S, 0, 1, 0];
  for (const [i, v] of Object.entries(over)) e[Number(i)] = v;
  return e;
};
const account = { id: '42', handle: 'moi', addedAt: 1, mutualsOnly: false, lastScan: { at: 1, detected: 10, scanned: 10, complete: true } };
const data = () => ({
  settings: { frequencyHours: 6, badge: true },
  accounts: { '42': account },
  sel: '42',
  'acc:42:events': [event(), event({ 0: 1 })],
  'acc:42:ign': ['999'],
  'acc:42:snapshot': { at: 1, ids: ['1', '2'], total: 2, ordered: true, top: ['1'] },
  'acc:42:profiles': { '1': { handle: 'a', name: 'A', following: true, avatar: 'https://pbs.twimg.com/p.jpg' } },
  'acc:42:partial': { kind: 'check', at: 1, expectedTotal: 5, collected: {} },
  'acc:42:suspicious': 1,
  'acc:42:visit': 1,
});
const valid = () => ({ app: 'xghost', format: 2, version: '1.0.0', exportedAt: 1, data: data() as Record<string, unknown> });

/** Remplace une valeur et vérifie le refus. */
const refused = (key: string, value: unknown) => {
  const b = valid();
  b.data[key] = value;
  return validateBackup(b, '1.0.0');
};

describe('validateBackup', () => {
  it('accepte une sauvegarde valide', () => {
    const res = validateBackup(valid(), '1.0.0');
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.backup.data.accounts).toEqual({ '42': account });
  });

  it('garde tous les champs d’un compte (aucun champ perdu à l’import)', () => {
    const full = {
      ...account,
      name: 'Moi',
      baselineAt: 1,
      lastScanAt: 2,
      followersCount: 10,
      mutualsOnly: true,
      pending: { count: 2, at: 3, full: true },
      quickSinceFull: 4,
      lastQuick: { at: 5, arrivals: 1, departed: 1, missing: 2, overflow: false, total: 10, staleRuns: 1, job: 6 },
      baselineRetry: { attempts: 2, at: 7 },
    };
    const b = valid();
    b.data.accounts = { '42': full };
    const res = validateBackup(b, '1.0.0');
    expect(res.ok && res.backup.data.accounts).toEqual({ '42': full });
  });

  it('accepte une sauvegarde de xGhost 1.0 (sync + local) et la convertit', () => {
    const legacy = {
      app: 'xghost',
      format: 1,
      version: '1.0.0',
      exportedAt: 1,
      sync: { accounts: { '42': account }, 'acc:42:evn': 1, 'acc:42:ev:0': [event()] },
      local: { machine: 'abc', 'acc:42:archive': [event({ 0: 1, 3: NOW_S - 10 })] },
    };
    const res = validateBackup(legacy, '1.0.0');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(Object.keys(res.backup.data).sort()).toEqual(['acc:42:events', 'accounts']);
      expect(res.backup.data['acc:42:events']).toHaveLength(2);
    }
    // Morceau d'historique corrompu dans un ancien fichier : refusé aussi.
    expect(validateBackup({ ...legacy, sync: { ...legacy.sync, 'acc:42:ev:0': 5 } }, '1.0.0').ok).toBe(false);
  });

  it("refuse un fichier d'une autre application, d'un autre format, ou illisible", () => {
    expect(validateBackup(null, '1.0.0')).toEqual({ ok: false, error: 'invalid' });
    expect(validateBackup([], '1.0.0')).toEqual({ ok: false, error: 'invalid' });
    expect(validateBackup({ ...valid(), app: 'barrage' }, '1.0.0')).toEqual({ ok: false, error: 'invalid' });
    expect(validateBackup({ ...valid(), format: 3 }, '1.0.0')).toEqual({ ok: false, error: 'invalid' });
    expect(validateBackup({ ...valid(), data: [] }, '1.0.0')).toEqual({ ok: false, error: 'invalid' });
  });

  it('refuse une sauvegarde produite par une version plus récente', () => {
    expect(validateBackup({ ...valid(), version: '1.2.0' }, '1.0.0')).toEqual({ ok: false, error: 'newer' });
    expect(validateBackup({ ...valid(), version: '0.9.0' }, '1.0.0').ok).toBe(true);
  });

  it('refuse les comptes corrompus (§1)', () => {
    expect(refused('accounts', { '42': null }).ok).toBe(false);
    expect(refused('accounts', { '42': { ...account, id: '43' } }).ok).toBe(false);
    expect(refused('accounts', { abc: { ...account, id: 'abc' } }).ok).toBe(false);
    expect(refused('accounts', { '42': { ...account, handle: 'settings/deactivate' } }).ok).toBe(false);
    expect(refused('accounts', { '42': { ...account, addedAt: 'x' } }).ok).toBe(false);
  });

  it('refuse les événements et listes corrompus (§2)', () => {
    expect(refused('acc:42:events', 1).ok).toBe(false);
    expect(refused('acc:42:events', [null]).ok).toBe(false);
    expect(refused('acc:42:events', [event({ 3: 'x' })]).ok).toBe(false);
    expect(refused('acc:42:ign', 1).ok).toBe(false);
    expect(refused('acc:42:ign', {}).ok).toBe(false);
    expect(refused('acc:42:snapshot', { at: 1, ids: 5, total: 1 }).ok).toBe(false);
  });

  it('refuse des profils dangereux ou malformés (§1, §9)', () => {
    const profile = (p: object) => ({ '1': { handle: 'a', name: 'A', following: false, ...p } });
    expect(refused('acc:42:profiles', profile({ name: {} })).ok).toBe(false);
    expect(refused('acc:42:profiles', profile({ name: 5 })).ok).toBe(false);
    expect(refused('acc:42:profiles', profile({ avatar: 'https://attacker.tld/p.gif' })).ok).toBe(false);
    expect(refused('acc:42:profiles', profile({ avatar: 'javascript:alert(1)' })).ok).toBe(false);
  });

  it('nettoie les réglages au lieu de les recopier (§3)', () => {
    const b = valid();
    b.data.settings = { frequencyHours: 0.001, badge: 'x', extra: 1 };
    const res = validateBackup(b, '1.0.0');
    expect(res.ok && res.backup.data.settings).toEqual({});
  });

  it('refuse les clés inconnues, y compris les pièges de prototype et les anciennes clés', () => {
    expect(refused('inconnue', 1).ok).toBe(false);
    expect(refused('acc:42:constructor', 1).ok).toBe(false);
    expect(refused('acc:42:ev:0', []).ok).toBe(false);
    expect(refused('machine', 'x').ok).toBe(false);
  });

  it("ignore l'état passager", () => {
    const b = valid();
    Object.assign(b.data, { scanTab: { tabId: 1 }, 'acc:42:job': {}, 'acc:42:progress': {} });
    const res = validateBackup(b, '1.0.0');
    expect(res.ok).toBe(true);
    if (res.ok) expect(Object.keys(res.backup.data)).not.toContain('acc:42:job');
  });
});

describe('clés sauvegardées', () => {
  it("n'exporte ni l'état passager ni les anciennes clés", () => {
    expect(isTransientKey('acc:1:job')).toBe(true);
    expect(isBackupKey('machine')).toBe(false);
    expect(isBackupKey('xOperations')).toBe(false);
    expect(isBackupKey('acc:1:snapshot')).toBe(true);
    expect(isBackupKey('acc:1:events')).toBe(true);
    expect(isBackupKey('acc:1:ev:3')).toBe(false);
    expect(Object.keys(backupItems({ settings: {}, machine: 'x', transport: 1, 'acc:1:visit': 1 }))).toEqual([
      'settings',
      'acc:1:visit',
    ]);
  });
});

describe('lecture défensive des événements', () => {
  it('écarte les entrées corrompues au lieu de planter', () => {
    expect(isCompactEvent(event())).toBe(true);
    expect(isCompactEvent(null)).toBe(false);
    expect(isCompactEvent(event({ 3: Number.NaN }))).toBe(false);
    expect(isCompactEvent(event({ 1: 'abc' }))).toBe(false);
    expect(compactEventsOf(1)).toEqual([]);
    expect(compactEventsOf([null, event(), 'x'])).toHaveLength(1);
    expect(decodeEvent(compactEventsOf([event()])[0]!).at).toBe(NOW_S * 1000);
  });
});
