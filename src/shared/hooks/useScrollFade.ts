import { useCallback, useLayoutEffect, useState, type RefObject } from 'react';

/**
 * Liste qui défile : `true` tant qu'il reste du contenu plus bas (fondu en bas, classe
 * `xg-scroll-fade`). Recalculé au défilement (`onScroll`), quand `deps` change et au
 * redimensionnement.
 */
export function useScrollFade(ref: RefObject<HTMLElement | null>, deps: unknown) {
  const [more, setMore] = useState(false);
  const update = useCallback(() => {
    const el = ref.current;
    setMore(!!el && el.scrollTop + el.clientHeight < el.scrollHeight - 2);
  }, [ref]);
  useLayoutEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref, update, deps]);
  return { more, onScroll: update };
}
