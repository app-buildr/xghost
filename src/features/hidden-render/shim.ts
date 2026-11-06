/**
 * Rendu en arrière-plan pour l'onglet de scan (monde MAIN, onglet de scan uniquement).
 *
 * Chrome n'actualise plus l'affichage d'un onglet caché : `requestAnimationFrame`,
 * `IntersectionObserver` et `ResizeObserver` ne se déclenchent plus, et x.com ne
 * charge donc plus la suite de la liste. Tant que l'onglet est caché, ce module
 * remplace ces trois mécanismes par des équivalents calculés à la demande
 * (`getBoundingClientRect` fonctionne même sans affichage). Ils sont actionnés à
 * chaque pas de défilement envoyé par xGhost. Onglet visible : comportement natif.
 */

const hidden = () => document.visibilityState === 'hidden';

type Margins = [number, number, number, number]; // haut, droite, bas, gauche

function parseMargin(value: string | undefined, width: number, height: number): Margins {
  const parts = (value ?? '0px').trim().split(/\s+/);
  const px = (v: string | undefined, ref: number) =>
    !v ? 0 : v.endsWith('%') ? (parseFloat(v) / 100) * ref : parseFloat(v) || 0;
  const [t, r = t, b = t, l = r] = parts;
  return [px(t, height), px(r, width), px(b, height), px(l, width)];
}

interface Polled {
  poll(): void;
}

export interface HiddenRenderShim {
  /** Fait avancer le rendu simulé. */
  step: () => void;
  /** Rend à la page ses mécanismes natifs (sauf si elle les a remplacés entre-temps). */
  uninstall: () => void;
}

export function installHiddenRenderShim(): HiddenRenderShim {
  const polled = new Set<Polled>();

  // --- requestAnimationFrame -------------------------------------------------
  const nativeRaf = window.requestAnimationFrame.bind(window);
  const nativeCaf = window.cancelAnimationFrame.bind(window);
  const frames = new Map<number, FrameRequestCallback>();
  let frameId = 1_000_000_000;
  let flushScheduled = false;

  const flushFrames = () => {
    flushScheduled = false;
    if (frames.size === 0) return;
    const callbacks = [...frames.values()];
    frames.clear();
    const now = performance.now();
    for (const cb of callbacks) {
      try {
        cb(now);
      } catch (err) {
        console.error(err);
      }
    }
  };

  const originalRaf = window.requestAnimationFrame;
  const originalCaf = window.cancelAnimationFrame;
  const raf = (cb: FrameRequestCallback): number => {
    if (!hidden()) return nativeRaf(cb);
    const id = ++frameId;
    frames.set(id, cb);
    if (!flushScheduled) {
      flushScheduled = true;
      setTimeout(flushFrames, 16);
    }
    return id;
  };
  const caf = (id: number) => {
    if (!frames.delete(id)) nativeCaf(id);
  };
  window.requestAnimationFrame = raf;
  window.cancelAnimationFrame = caf;

  // --- IntersectionObserver --------------------------------------------------
  const NativeIO = window.IntersectionObserver;
  class HiddenAwareIO extends NativeIO implements Polled {
    private readonly cb: IntersectionObserverCallback;
    private readonly opts?: IntersectionObserverInit;
    private readonly targets = new Map<Element, boolean | undefined>();

    constructor(cb: IntersectionObserverCallback, opts?: IntersectionObserverInit) {
      super(cb, opts);
      this.cb = cb;
      this.opts = opts;
    }
    // Interrogé seulement tant qu'il observe quelque chose : un observateur abandonné par la page
    // (et le DOM qu'il retient) n'est pas gardé en vie pendant tout le scan.
    override observe(target: Element): void {
      super.observe(target);
      this.targets.set(target, undefined);
      polled.add(this);
    }
    override unobserve(target: Element): void {
      super.unobserve(target);
      this.targets.delete(target);
      if (this.targets.size === 0) polled.delete(this);
    }
    override disconnect(): void {
      super.disconnect();
      this.targets.clear();
      polled.delete(this);
    }
    poll(): void {
      if (this.targets.size === 0) return;
      const root = this.opts?.root instanceof Element ? this.opts.root : null;
      const base = root
        ? root.getBoundingClientRect()
        : DOMRectReadOnly.fromRect({ x: 0, y: 0, width: innerWidth, height: innerHeight });
      const [mt, mr, mb, ml] = parseMargin(this.opts?.rootMargin, base.width, base.height);
      const top = base.top - mt;
      const right = base.right + mr;
      const bottom = base.bottom + mb;
      const left = base.left - ml;
      const rootBounds = DOMRectReadOnly.fromRect({ x: left, y: top, width: right - left, height: bottom - top });

      const entries: IntersectionObserverEntry[] = [];
      for (const [target, previous] of this.targets) {
        const r = target.getBoundingClientRect();
        const iw = Math.max(0, Math.min(r.right, right) - Math.max(r.left, left));
        const ih = Math.max(0, Math.min(r.bottom, bottom) - Math.max(r.top, top));
        const touching = r.bottom >= top && r.top <= bottom && r.right >= left && r.left <= right;
        const isIntersecting = touching && target.isConnected;
        if (isIntersecting === previous) continue;
        this.targets.set(target, isIntersecting);
        const area = r.width * r.height;
        entries.push({
          target,
          isIntersecting,
          intersectionRatio: area > 0 ? (iw * ih) / area : isIntersecting ? 1 : 0,
          boundingClientRect: r,
          intersectionRect: DOMRectReadOnly.fromRect({
            x: Math.max(r.left, left),
            y: Math.max(r.top, top),
            width: iw,
            height: ih,
          }),
          rootBounds,
          time: performance.now(),
        } as IntersectionObserverEntry);
      }
      if (entries.length) this.cb(entries, this);
    }
  }
  window.IntersectionObserver = HiddenAwareIO;

  // --- ResizeObserver --------------------------------------------------------
  const NativeRO = window.ResizeObserver;
  class HiddenAwareRO extends NativeRO implements Polled {
    private readonly cb: ResizeObserverCallback;
    private readonly targets = new Map<Element, string | undefined>();

    constructor(cb: ResizeObserverCallback) {
      super(cb);
      this.cb = cb;
    }
    override observe(target: Element, options?: ResizeObserverOptions): void {
      super.observe(target, options);
      this.targets.set(target, undefined);
      polled.add(this);
    }
    override unobserve(target: Element): void {
      super.unobserve(target);
      this.targets.delete(target);
      if (this.targets.size === 0) polled.delete(this);
    }
    override disconnect(): void {
      super.disconnect();
      this.targets.clear();
      polled.delete(this);
    }
    poll(): void {
      const entries: ResizeObserverEntry[] = [];
      for (const [target, previous] of this.targets) {
        if (!target.isConnected) continue;
        const r = target.getBoundingClientRect();
        const key = `${r.width}x${r.height}`;
        if (key === previous) continue;
        this.targets.set(target, key);
        const size = [{ inlineSize: r.width, blockSize: r.height }];
        entries.push({
          target,
          contentRect: DOMRectReadOnly.fromRect({ x: 0, y: 0, width: r.width, height: r.height }),
          borderBoxSize: size,
          contentBoxSize: size,
          devicePixelContentBoxSize: size,
        } as unknown as ResizeObserverEntry);
      }
      if (entries.length) this.cb(entries, this);
    }
  }
  window.ResizeObserver = HiddenAwareRO;

  // --- Pas de défilement --------------------------------------------------------
  const step = () => {
    if (!hidden()) return;
    window.dispatchEvent(new Event('scroll'));
    flushFrames();
    for (const o of polled) {
      try {
        o.poll();
      } catch (err) {
        console.error(err);
      }
    }
    flushFrames();
  };
  // Repli si aucun pas n'arrive (Chrome espace ce minuteur quand l'onglet est caché).
  const fallback = setInterval(step, 1000);
  const uninstall = () => {
    clearInterval(fallback);
    polled.clear();
    flushFrames();
    if (window.requestAnimationFrame === raf) window.requestAnimationFrame = originalRaf;
    if (window.cancelAnimationFrame === caf) window.cancelAnimationFrame = originalCaf;
    if (window.IntersectionObserver === HiddenAwareIO) window.IntersectionObserver = NativeIO;
    if (window.ResizeObserver === HiddenAwareRO) window.ResizeObserver = NativeRO;
  };
  // `step` est appelée par le script de page à chaque pas reçu du canal privé.
  return { step, uninstall };
}
