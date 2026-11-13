import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { send } from '@/shared/messaging/client';
import type { TrackedAccount } from '@/shared/types';
import '@/shared/ui/theme.css';
import '@/shared/ui/ui.css';
import { AccountsList } from './AccountsList';

vi.mock('@/shared/messaging/client', () => ({ send: vi.fn() }));

const NOW = Date.UTC(2026, 10, 1);
const account = (id: string) => ({ id, handle: `user${id}`, addedAt: Number(id), baselineAt: 1 }) as TrackedAccount;
const A = account('1');
const B = account('2');

let root: Root | undefined;
let host: HTMLElement | undefined;

afterEach(() => {
  act(() => root?.unmount());
  host?.remove();
  root = undefined;
  host = undefined;
  vi.mocked(send).mockReset();
});

/** Affiche (ou met à jour, comme le ferait un changement du stockage) la liste des comptes. */
function render(accounts: TrackedAccount[], selectedId = accounts[0]?.id) {
  if (!host) {
    host = document.createElement('div');
    host.style.width = '260px';
    document.body.append(host);
    root = createRoot(host);
  }
  act(() =>
    root?.render(<AccountsList accounts={accounts} selectedId={selectedId} unseen={{}} now={NOW} onSelect={() => undefined} />),
  );
}

const row = (a: TrackedAccount) =>
  [...document.querySelectorAll<HTMLElement>('.xg-account-row')].find(
    (li) => li.querySelector('.xg-account__handle')?.textContent === `@${a.handle}`,
  );
const trash = (a: TrackedAccount) => row(a)!.querySelector<HTMLButtonElement>('.xg-account-row__remove')!;
const confirmBox = () => document.querySelector<HTMLElement>('.xg-account-row__confirm');
const confirmButtons = () => [...confirmBox()!.querySelectorAll<HTMLButtonElement>('button')] as [HTMLButtonElement, HTMLButtonElement];

const openConfirm = (a: TrackedAccount) => act(() => trash(a).click());

describe('suppression d’un compte depuis la liste', () => {
  it('ouvre la confirmation dans la ligne, focus sur Annuler ; Échap la ferme et rend le focus à la corbeille', () => {
    render([A, B]);
    openConfirm(A);

    expect(row(A)!.contains(confirmBox())).toBe(true);
    expect(trash(A).getAttribute('aria-expanded')).toBe('true');
    expect(trash(A).getAttribute('aria-controls')).toBe(confirmBox()!.id);
    const [, cancel] = confirmButtons();
    expect(document.activeElement).toBe(cancel);

    act(() => {
      cancel.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    });

    expect(confirmBox()).toBeNull();
    expect(document.activeElement).toBe(trash(A));
    expect(send).not.toHaveBeenCalled();
  });

  it('supprime le compte, puis rend le focus au compte affiché', async () => {
    vi.mocked(send).mockResolvedValue(undefined);
    render([A, B], A.id);
    openConfirm(A);

    const [remove] = confirmButtons();
    await act(async () => remove.click());

    expect(send).toHaveBeenCalledWith('account:remove', { accountId: A.id });
    expect(remove.disabled).toBe(true);

    // Le service worker a retiré le compte et affiche le suivant.
    render([B], B.id);

    expect(row(A)).toBeUndefined();
    expect(confirmBox()).toBeNull();
    expect(document.activeElement).toBe(row(B)!.querySelector('.xg-account'));
  });

  it('garde la confirmation ouverte si la suppression échoue', async () => {
    vi.mocked(send).mockRejectedValue(new Error('refusé'));
    render([A, B]);
    openConfirm(A);

    const [remove] = confirmButtons();
    await act(async () => remove.click());

    expect(confirmBox()).not.toBeNull();
    expect(remove.disabled).toBe(false);
  });

  it('ne rouvre pas la confirmation quand le compte, supprimé ailleurs, est de nouveau détecté', () => {
    render([A, B]);
    openConfirm(A);

    render([B]);
    expect(confirmBox()).toBeNull();

    render([A, B]);
    expect(confirmBox()).toBeNull();
    expect(trash(A).getAttribute('aria-expanded')).toBe('false');
  });
});
