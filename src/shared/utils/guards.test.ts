import { describe, expect, it } from 'vitest';
import { nativeGetter } from './guards';

class Native {
  get url() {
    return 'native';
  }
}
class Wrapped extends Native {}
class Overriding extends Wrapped {
  override get url() {
    return 'wrapped';
  }
}

describe('nativeGetter', () => {
  it('trouve l’accesseur quand une sous-classe a remplacé la classe', () => {
    expect(nativeGetter(Wrapped.prototype, 'url')?.call(new Wrapped())).toBe('native');
  });
  it('préfère l’accesseur natif à celui d’une sous-classe', () => {
    expect(nativeGetter(Overriding.prototype, 'url')?.call(new Overriding())).toBe('native');
  });
  it('propriété absente : rien', () => {
    expect(nativeGetter(Native.prototype, 'autre')).toBeUndefined();
  });
});
