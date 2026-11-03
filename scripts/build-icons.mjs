// Génère les icônes PNG de l'extension (§ 3.1) à partir d'un SVG unique.
// Variantes : normale, « scan en cours » (flèches teal), « déconnecté » (grise, sans point).
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SIZES = [16, 32, 48, 128];

const INK = '#111318';
const ACCENT = '#FF6B4A';
const PRIMARY = '#0F766E';
const DISABLED = '#9AA1AD';

function svg({ bg, eyes, dot, scan }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">
  <rect width="128" height="128" rx="30" fill="${bg}"/>
  <path d="M36 60a28 28 0 0 1 56 0v38l-9.33-8-9.33 8-9.34-8-9.33 8-9.33-8-9.34 8z" fill="#fff"/>
  <circle cx="54" cy="62" r="5.5" fill="${eyes}"/>
  <circle cx="74" cy="62" r="5.5" fill="${eyes}"/>
  ${dot ? `<circle cx="99" cy="29" r="11" fill="${ACCENT}"/>` : ''}
  ${
    scan
      ? `<circle cx="98" cy="98" r="28" fill="${INK}"/>
  <circle cx="98" cy="98" r="23" fill="${PRIMARY}"/>
  <g fill="none" stroke="#fff" stroke-width="5" stroke-linecap="round" stroke-linejoin="round">
    <path d="M87 96a11.5 11.5 0 0 1 20-6.5"/><path d="M108 83v7h-7"/>
    <path d="M109 100a11.5 11.5 0 0 1-20 6.5"/><path d="M88 113v-7h7"/>
  </g>`
      : ''
  }
</svg>`;
}

const variants = {
  icon: (size) => svg({ bg: INK, eyes: INK, dot: size > 16, scan: false }),
  'icon-scan': () => svg({ bg: INK, eyes: INK, dot: false, scan: true }),
  'icon-off': () => svg({ bg: DISABLED, eyes: DISABLED, dot: false, scan: false }),
};

for (const [dir, make] of Object.entries(variants)) {
  for (const size of SIZES) {
    const png = new Resvg(make(size), { fitTo: { mode: 'width', value: size } }).render().asPng();
    const out = join(root, 'public', dir, `${size}.png`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, png);
  }
}
writeFileSync(join(root, 'src/shared/ui/logo.svg'), variants.icon(128));
console.log('Icônes générées dans public/');
