import { describe, expect, it } from 'vitest';
import { isBackupKey, isTransientKey } from '@/features/backup/format';
import { accountIdOfKey, accountKeysOf, isDisplayKey, isProgressKey, keys } from './keys';

/** Valeurs écrites dans le stockage et les sauvegardes : elles ne doivent jamais changer. */
const SUFFIXES = ['events', 'ign', 'snapshot', 'profiles', 'job', 'progress', 'partial', 'suspicious', 'visit', 'repaired', 'totals', 'verify', 'hidden'];

describe('clés de compte', () => {
  it('les suffixes stockés ne changent pas', () => {
    expect(accountKeysOf('42')).toEqual(SUFFIXES.map((s) => `acc:42:${s}`));
  });

  it('chaque clé est soit sauvegardée, soit propre à cette installation', () => {
    for (const key of accountKeysOf('42')) expect(isBackupKey(key)).toBe(!isTransientKey(key));
  });

  it('scan en cours : jamais exporté', () => {
    expect(isTransientKey(keys.scanJob('42'))).toBe(true);
    expect(isTransientKey(keys.scanProgress('42'))).toBe(true);
    expect(isTransientKey(keys.events('42'))).toBe(false);
  });

  it('seules les données affichées rechargent l’historique', () => {
    expect(isDisplayKey(keys.events('42'), '42')).toBe(true);
    expect(isDisplayKey(keys.events('7'), '42')).toBe(false);
    expect(isDisplayKey(keys.scanJob('42'), '42')).toBe(false);
    expect(isDisplayKey(keys.snapshot('42'), '42')).toBe(false);
  });

  it('les compteurs de non-vus sont déduits : jamais sauvegardés', () => {
    expect(isBackupKey(keys.unseen)).toBe(false);
    expect(isTransientKey(keys.unseen)).toBe(true);
  });

  it('reconnaît les clés de compte', () => {
    expect(accountIdOfKey('acc:42:events')).toBe('42');
    expect(accountIdOfKey('settings')).toBeUndefined();
    expect(isProgressKey('acc:42:progress')).toBe(true);
    expect(isProgressKey('acc:42:job')).toBe(false);
  });
});
