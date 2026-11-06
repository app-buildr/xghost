import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AccountData } from '@/features/app-state/useAccountData';
import { DisplayedContext } from '@/features/app-state/useSeenOnView';
import type { VisibilityContext } from '@/domain/events/selectors';
import type { FollowEvent, TrackedAccount } from '@/shared/types';
import '@/shared/ui/theme.css';
import '@/shared/ui/ui.css';
import '@/features/options/ui/options.css';
import '@/features/dashboard/ui/dashboard.css';
import { DeparturesPanel } from './DeparturesPanel';

const NOW = Date.UTC(2026, 10, 1);
/** Assez pour voir une liste non bornée, assez peu pour qu'un tel bug échoue vite au lieu de figer le test. */
const LONG = 5000;
const ACCOUNT = { id: 'me', handle: 'me', baselineAt: 0 } as TrackedAccount;
const CTX: VisibilityContext = { ignored: new Set(), mutualsOnly: false };

const departures = (count: number): FollowEvent[] =>
  Array.from({ length: count }, (_, i) => ({
    id: `e${i}`,
    type: 'departure',
    profileId: `p${i}`,
    handle: `user${i}`,
    at: NOW - i * 60_000,
    status: 'active',
    mutual: i % 3 === 0,
    seen: false,
  }));

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
});

/** Affiche la liste complète (ou, avec `width`, dans un panneau de cette largeur). */
function renderList(events: FollowEvent[], { width = 900 } = {}) {
  const seen = new Set<string>();
  const data = { events, profiles: {} } as unknown as AccountData;
  host = document.createElement('div');
  host.className = 'xg-options__content--list';
  host.style.width = `${width}px`;
  document.body.append(host);
  root = createRoot(host);
  act(() =>
    root?.render(
      <DisplayedContext.Provider value={(ids) => ids.forEach((id) => seen.add(id))}>
        <DeparturesPanel title="Départs" account={ACCOUNT} data={data} ctx={CTX} now={NOW} />
      </DisplayedContext.Provider>,
    ),
  );
  return seen;
}

const list = () => document.querySelector<HTMLElement>('.xg-dep-list')!;
const rows = () => [...list().querySelectorAll<HTMLElement>('[data-id]')];

/** Fait défiler la liste jusqu'à ce que `reached` soit vrai (les hauteurs s'ajustent à la mesure). */
async function scrollUntil(top: number, reached: () => boolean) {
  await vi.waitFor(
    () => {
      list().scrollTop = top;
      expect(reached()).toBe(true);
    },
    { timeout: 3000, interval: 50 },
  );
}

describe('liste virtualisée', () => {
  it('reste bornée en hauteur et en lignes, quelle que soit la longueur de la liste', async () => {
    renderList(departures(LONG));
    await vi.waitFor(() => expect(rows().length).toBeGreaterThan(0));

    expect(list().getBoundingClientRect().height).toBeLessThan(window.innerHeight);
    expect(list().scrollHeight).toBeGreaterThan(LONG * 70);
    expect(rows().length).toBeLessThan(40);
  });

  it('atteint la dernière ligne, sans monter plus de lignes', async () => {
    renderList(departures(LONG));
    await vi.waitFor(() => expect(rows().length).toBeGreaterThan(0));

    await scrollUntil(1e9, () => rows().at(-1)?.dataset.id === `e${LONG - 1}`);

    expect(rows().length).toBeLessThan(40);
    expect(rows().at(-1)?.getAttribute('aria-posinset')).toBe(String(LONG));
    expect(rows().at(-1)?.getAttribute('aria-setsize')).toBe(String(LONG));
  });

  it('ne marque vues que les lignes passées à l’écran', async () => {
    const seen = renderList(departures(LONG));
    await vi.waitFor(() => expect(seen.has('e0')).toBe(true));

    await scrollUntil(200_000, () => rows()[0]?.dataset.id !== 'e0');
    const reached = rows()[10]?.dataset.id;
    await vi.waitFor(() => expect(seen.has(reached ?? '')).toBe(true));

    expect(seen.size).toBeLessThan(40);
    expect(seen.has('e1000')).toBe(false);
  });

  it('ne rejoue pas l’animation d’entrée au défilement', async () => {
    renderList(departures(1000));
    await vi.waitFor(() => expect(list().classList.contains('xg-list-in')).toBe(true));

    await scrollUntil(5000, () => !list().classList.contains('xg-list-in'));
  });
});

describe('ligne de la liste', () => {
  /** Écart au centre de la ligne du texte visible (pas de son bloc, centré même s'il a un vide en bas). */
  const offsetFromCenter = (row: HTMLElement) => {
    const text = [...row.querySelectorAll<HTMLElement>('.xg-dep__body .xg-dep__title, .xg-dep__body .xg-dep__meta, .xg-dep__body time')]
      .filter((el) => el.offsetParent)
      .map((el) => el.getBoundingClientRect());
    const top = Math.min(...text.map((r) => r.top));
    const bottom = Math.max(...text.map((r) => r.bottom));
    const box = row.getBoundingClientRect();
    return Math.abs((top + bottom) / 2 - (box.top + box.bottom) / 2);
  };

  it.each([900, 480])('centre le nom et le pseudo dans un panneau de %i px', async (width) => {
    renderList(departures(5), { width });
    await vi.waitFor(() => expect(rows().length).toBe(5));

    expect(offsetFromCenter(rows()[0]!)).toBeLessThanOrEqual(1);
  });

  it('n’affiche la date qu’à un seul endroit', async () => {
    renderList(departures(5));
    await vi.waitFor(() => expect(rows().length).toBe(5));

    const dates = [...rows()[0]!.querySelectorAll<HTMLElement>('time')].filter((time) => time.offsetParent);
    expect(dates).toHaveLength(1);
  });
});
