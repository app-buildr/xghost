import { describe, expect, it } from 'vitest';
import { isNewer, isOlder, parseVersion } from './version';

describe('parseVersion', () => {
  it('accepte « v1.2.3 » et « 1.2.3 »', () => {
    expect(parseVersion('v1.2.3')).toBe('1.2.3');
    expect(parseVersion(' 1.2.3 ')).toBe('1.2.3');
  });
  it('refuse le reste', () => {
    expect(parseVersion('1.2')).toBeNull();
    expect(parseVersion('v1.2.3-beta')).toBeNull();
    expect(parseVersion(123)).toBeNull();
  });
});

describe('isNewer', () => {
  it('compare chaque partie numériquement', () => {
    expect(isNewer('1.10.0', '1.9.9')).toBe(true);
    expect(isNewer('2.0.0', '1.99.99')).toBe(true);
  });
  it('rien si identique, plus ancien ou illisible', () => {
    expect(isNewer('1.0.0', '1.0.0')).toBe(false);
    expect(isNewer('1.0.0', '1.2.0')).toBe(false); // version de développement en avance
    expect(isNewer(null, '1.0.0')).toBe(false);
    expect(isNewer('n/a', '1.0.0')).toBe(false);
  });
});

describe('isOlder', () => {
  it('vraie seulement pour une version antérieure lisible', () => {
    expect(isOlder('1.0.4', '1.0.5')).toBe(true);
    expect(isOlder('1.0.5', '1.0.5')).toBe(false);
    expect(isOlder('1.0.6', '1.0.5')).toBe(false);
    expect(isOlder(undefined, '1.0.5')).toBe(false);
    expect(isOlder('dev', '1.0.5')).toBe(false);
  });
});
