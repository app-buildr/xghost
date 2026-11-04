import { describe, expect, it } from 'vitest';
import { sanitizeSettings } from './repository';

describe('réglages', () => {
  it('ne garde que les graphiques connus, dans l’ordre du tableau de bord', () => {
    expect(sanitizeSettings({ hiddenCharts: ['retention', 'inconnu', 3, 'followers'] }).hiddenCharts).toEqual([
      'followers',
      'retention',
    ]);
    expect(sanitizeSettings({ hiddenCharts: 'net' }).hiddenCharts).toBeUndefined();
  });
});
