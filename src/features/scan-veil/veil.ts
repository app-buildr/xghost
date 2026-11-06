import { Clock, createElement } from 'lucide';
import type { VeilState } from '@/shared/messaging/protocol';
import { COLORS } from '@/shared/ui/tokens';

/**
 * Overlay de l'onglet de scan (§ 3.5, écran 6) : voile sombre flouté qui bloque la page,
 * carte blanche de 400 px au centre. Deux états exclusifs : « en cours » ou « petite pause »
 * (limite de X). Pas d'état « terminé » : l'onglet se ferme dès la fin du scan.
 *
 * Hors de l'onglet (§ 4.6) : favicon du fantôme entouré d'un anneau de progression, car un
 * onglet épinglé n'affiche que son icône. Le titre reste celui de x.com.
 *
 * Rendu dans un Shadow DOM pour ne pas subir (ni modifier) les styles de x.com.
 */

const C = COLORS;

const STYLE = `
  :host { all: initial; }
  .veil {
    position: fixed; inset: 0; z-index: 2147483647;
    display: grid; place-items: center; padding: 24px;
    background: rgba(17, 19, 24, .62);
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px);
    cursor: default;
    font: 400 16px/1.5 Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
    color: ${C.ink};
  }
  .card {
    width: min(400px, 100%); box-sizing: border-box;
    background: ${C.surface}; border-radius: 20px; padding: 28px;
    box-shadow: 0 24px 60px rgba(17, 19, 24, .28);
    display: grid; gap: 14px;
  }
  .head { display: flex; align-items: center; gap: 10px; }
  .head img { width: 32px; height: 32px; border-radius: 8px; }
  .brand { font: 800 19px/1 Manrope, Inter, system-ui, sans-serif; letter-spacing: -.01em; }
  .handle { margin-left: auto; color: ${C.textMuted}; font-size: 14px; }
  h2 { margin: 6px 0 0; font: 800 23px/1.25 Manrope, Inter, system-ui, sans-serif; letter-spacing: -.015em; }
  p { margin: 0; color: ${C.textMuted}; font-size: 15px; }
  .row { display: flex; align-items: baseline; gap: 8px; margin-top: 6px; }
  .count { font: 800 40px/1 Manrope, Inter, system-ui, sans-serif; letter-spacing: -.02em; font-variant-numeric: tabular-nums; }
  .total { color: ${C.textMuted}; font-size: 18px; font-variant-numeric: tabular-nums; }
  .pct { margin-left: auto; font-weight: 600; font-size: 15px; color: ${C.primary}; font-variant-numeric: tabular-nums; }
  .bar { height: 8px; border-radius: 999px; background: ${C.primarySoft}; overflow: hidden; }
  .fill { height: 100%; width: 0; border-radius: inherit; background: ${C.primary}; transition: width .4s ease; }
  .foot { color: ${C.textMuted}; font-size: 14px; }
  .chip {
    display: flex; align-items: center; gap: 10px;
    background: ${C.surfaceMuted}; border-radius: 12px; padding: 12px 16px;
    color: ${C.textSubtle}; font-size: 15px; font-variant-numeric: tabular-nums;
  }
  .chip svg { flex: none; }
  .paused .pct { color: ${C.textSubtle}; }
  .paused .bar { background: ${C.track}; }
  .paused .fill { background: ${C.disabledIcon}; }
  [hidden] { display: none !important; }
`;

interface Veil {
  card: HTMLElement;
  brand: HTMLElement;
  handle: HTMLElement;
  title: HTMLElement;
  text: HTMLElement;
  count: HTMLElement;
  total: HTMLElement;
  pct: HTMLElement;
  fill: HTMLElement;
  foot: HTMLElement;
  chip: HTMLElement;
  chipText: HTMLElement;
}

let veil: Veil | undefined;
let veilHost: HTMLElement | undefined;
let last: VeilState | undefined;
let countdown: ReturnType<typeof setInterval> | undefined;

function el<K extends keyof HTMLElementTagNameMap>(tag: K, className?: string, text?: string) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

function create(): Veil | undefined {
  if (!document.documentElement) return undefined;
  // Pas d'identifiant repérable. La page peut voir qu'un élément a été ajouté, pas son contenu.
  const host = document.createElement('div');
  veilHost = host;
  const root = host.attachShadow({ mode: 'closed' });
  const style = el('style');
  style.textContent = STYLE;

  const overlay = el('div', 'veil');
  // L'utilisateur ne peut pas interagir avec la page pendant le scan (§ 4.6), ni la faire défiler
  // (molette, pavé tactile, écran tactile) : seul le défilement automatique de xGhost la fait avancer.
  for (const type of ['click', 'mousedown', 'pointerdown', 'contextmenu', 'keydown', 'wheel', 'touchmove'] as const) {
    overlay.addEventListener(
      type,
      (e) => {
        e.preventDefault();
        e.stopPropagation();
      },
      { passive: false },
    );
  }

  const card = el('div', 'card');
  card.setAttribute('role', 'status');
  card.setAttribute('aria-live', 'polite');
  const head = el('div', 'head');
  const logo = el('img');
  logo.src = chrome.runtime.getURL('/icon/128.png');
  logo.alt = '';
  const brand = el('span', 'brand');
  const handle = el('span', 'handle');
  head.append(logo, brand, handle);

  const title = el('h2');
  const text = el('p');
  const row = el('div', 'row');
  const count = el('span', 'count', '…');
  const total = el('span', 'total');
  const pct = el('span', 'pct');
  row.append(count, total, pct);
  const bar = el('div', 'bar');
  const fill = el('div', 'fill');
  bar.append(fill);
  const foot = el('div', 'foot');
  const chip = el('div', 'chip');
  chip.append(createElement(Clock, { width: 18, height: 18, 'aria-hidden': 'true' }));
  const chipText = el('span');
  chip.append(chipText);

  card.append(head, title, text, row, bar, foot, chip);
  overlay.append(card);
  root.append(style, overlay);
  document.documentElement.append(host);
  return { card, brand, handle, title, text, count, total, pct, fill, foot, chip, chipText };
}

const fill = (template: string, values: Record<string, string | number>) =>
  template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(values[name] ?? ''));

/** Compte à rebours recalculé dans la page : le service worker dort pendant une pause. */
function countdownText({ texts, resumeAt }: VeilState): string {
  const { countdown: c } = texts;
  if (!resumeAt) return c.unknown;
  const seconds = Math.max(0, Math.round((resumeAt - Date.now()) / 1000));
  if (seconds === 0) return c.now;
  const m = Math.floor(seconds / 60);
  return m > 0 ? fill(c.minutesSeconds, { m, s: seconds % 60 }) : fill(c.seconds, { s: seconds });
}

function render(): void {
  if (!veil || !last) return;
  const s = last;
  const { texts } = s;
  const paused = s.state === 'rate-limit';
  veil.card.classList.toggle('paused', paused);
  veil.brand.textContent = texts.brand;
  veil.handle.textContent = texts.handle;
  veil.title.textContent = texts.title;
  veil.text.textContent = texts.text;
  veil.count.textContent = texts.count;
  veil.total.textContent = texts.total;
  veil.pct.textContent = texts.percent;
  veil.fill.style.width = `${s.percent}%`;
  veil.foot.hidden = paused;
  veil.chip.hidden = !paused;
  if (paused) veil.chipText.textContent = fill(texts.resume, { countdown: countdownText(s) });
  else veil.foot.textContent = texts.foot;

  if (paused && !countdown) countdown = setInterval(render, 1000);
  if (!paused && countdown) {
    clearInterval(countdown);
    countdown = undefined;
  }
  applyTabIdentity();
}

// --- Titre et favicon de l'onglet ---------------------------------------------------

let ghost: ImageBitmap | undefined;
let favicon: string | undefined;
let drawnKey: string | undefined;
let headObserver: MutationObserver | undefined;

async function loadGhost(): Promise<void> {
  if (ghost) return;
  try {
    const blob = await (await fetch(chrome.runtime.getURL('/icon/128.png'))).blob();
    ghost = await createImageBitmap(blob);
  } catch {
    // Pas de logo : l'anneau seul reste lisible.
  }
}

/** Fantôme entouré d'un anneau teal qui se remplit avec la progression. */
function drawFavicon(pct: number, paused: boolean): string {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  const r = 28;
  ctx.lineWidth = 7;
  ctx.lineCap = 'round';
  ctx.strokeStyle = paused ? C.track : C.primarySoft;
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = paused ? C.disabledIcon : C.primary;
  ctx.beginPath();
  ctx.arc(c, c, r, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * Math.max(pct, 2)) / 100);
  ctx.stroke();
  if (ghost) {
    const s = 34;
    ctx.save();
    ctx.beginPath();
    ctx.roundRect(c - s / 2, c - s / 2, s, s, 9);
    ctx.clip();
    ctx.drawImage(ghost, c - s / 2, c - s / 2, s, s);
    ctx.restore();
  }
  return canvas.toDataURL('image/png');
}

/**
 * Rétablit l'icône de l'onglet de scan (x.com la réécrit en naviguant). Le titre, lui, reste
 * celui de x.com : aucun texte de l'extension n'est lisible par la page.
 */
function reapplyIdentity(): void {
  document.head?.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]').forEach((link) => {
    if (favicon && link.href !== favicon) link.href = favicon;
  });
}

function applyTabIdentity(): void {
  if (!last || !document.head) return;
  // Redessiné seulement si l'image change : une page de scan n'avance pas toujours le pourcentage.
  const drawn = `${last.percent}:${last.state}:${!!ghost}`;
  if (drawn !== drawnKey) {
    drawnKey = drawn;
    favicon = drawFavicon(last.percent, last.state === 'rate-limit');
  }
  const links = document.head.querySelectorAll<HTMLLinkElement>('link[rel~="icon"]');
  if (links.length === 0) {
    const link = document.createElement('link');
    link.rel = 'icon';
    document.head.append(link);
  }
  reapplyIdentity();
  // x.com réécrit l'icône à chaque navigation interne : on la rétablit.
  if (!headObserver) {
    headObserver = new MutationObserver(reapplyIdentity);
    headObserver.observe(document.head, { subtree: true, childList: true, attributes: true });
  }
}

// --- Protection contre la fermeture -------------------------------------------------

const confirmLeave = (e: BeforeUnloadEvent) => {
  e.preventDefault();
  e.returnValue = '';
};

/** Touches qui feraient défiler la page (le focus reste dans la page, sous l'overlay). */
const SCROLL_KEYS = new Set([' ', 'PageUp', 'PageDown', 'Home', 'End', 'ArrowUp', 'ArrowDown']);
const blockScrollKeys = (e: KeyboardEvent) => {
  if (SCROLL_KEYS.has(e.key)) {
    e.preventDefault();
    e.stopPropagation();
  }
};

export function showVeil(): void {
  if (!veil || !veilHost?.isConnected) veil = create();
  window.addEventListener('beforeunload', confirmLeave);
  window.addEventListener('keydown', blockScrollKeys, { capture: true });
  void loadGhost().then(applyTabIdentity);
  render();
}

/** Fin du défilement (avant fermeture ou navigation de l'onglet par xGhost). */
export function releaseVeil(): void {
  window.removeEventListener('beforeunload', confirmLeave);
  window.removeEventListener('keydown', blockScrollKeys, { capture: true });
}

export function updateVeil(state: VeilState): void {
  last = state;
  showVeil();
}
