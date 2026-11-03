import { describe, expect, it } from 'vitest';
import { parseFollowersPage, parseUserLookup, variablesOf } from './parse';
import { parseTwid } from './session';

const user = (id: string, handle: string, following = false) => ({
  content: {
    itemContent: {
      itemType: 'TimelineUser',
      user_results: {
        result: { __typename: 'User', rest_id: id, core: { screen_name: handle, name: handle.toUpperCase() }, relationship_perspectives: { following } },
      },
    },
  },
});

describe('parseFollowersPage', () => {
  it('extrait utilisateurs et curseur suivant', () => {
    const data = {
      data: {
        user: {
          result: {
            timeline: {
              timeline: {
                instructions: [
                  { type: 'TimelineAddEntries', entries: [user('1', 'a', true), user('2', 'b'), { entryId: 'cursor-bottom-1', content: { cursorType: 'Bottom', value: '123|456' } }] },
                ],
              },
            },
          },
        },
      },
    };
    const page = parseFollowersPage(data);
    expect(page.users.map((u) => u.id)).toEqual(['1', '2']);
    expect(page.users[0]).toMatchObject({ handle: 'a', name: 'A', following: true });
    expect(page).toMatchObject({ nextCursor: '123|456', done: false });
  });
  it('fin de liste : curseur « 0|… » ou page vide', () => {
    const end = { data: { user: { result: { timeline: { timeline: { instructions: [{ entries: [user('1', 'a'), { entryId: 'cursor-bottom-0', content: { cursorType: 'Bottom', value: '0|999' } }] }] } } } } } };
    expect(parseFollowersPage(end).done).toBe(true);
    expect(parseFollowersPage({}).done).toBe(true);
  });
  it('accepte l’ancien format (legacy.screen_name)', () => {
    const legacy = {
      content: {
        itemContent: {
          user_results: {
            result: { __typename: 'User', rest_id: '9', legacy: { screen_name: 'old', name: 'Old', following: true } },
          },
        },
      },
    };
    const data = { data: { user: { result: { timeline: { timeline: { instructions: [{ entries: [legacy] }] } } } } } };
    expect(parseFollowersPage(data).users[0]).toMatchObject({ id: '9', handle: 'old', following: true });
  });
});

describe('parseUserLookup', () => {
  it('distingue actif, suspendu et supprimé', () => {
    expect(parseUserLookup({ data: { user: { result: { __typename: 'User', rest_id: '1', core: { screen_name: 'a' } } } } }).status).toBe('active');
    expect(parseUserLookup({ data: { user: { result: { __typename: 'UserUnavailable', reason: 'Suspended' } } } }).status).toBe('suspended');
    expect(parseUserLookup({ data: { user: {} } }).status).toBe('gone');
  });
});

describe('lecture des réponses de x.com', () => {
  it('lit les variables d’une URL GraphQL interceptée', () => {
    const url = `https://x.com/i/api/graphql/abc/Followers?variables=${encodeURIComponent(JSON.stringify({ userId: '42', count: 20, cursor: '1|2' }))}&features=%7B%7D`;
    expect(variablesOf(url)).toMatchObject({ userId: '42', cursor: '1|2' });
    expect(variablesOf('https://x.com/home')).toEqual({});
  });
  it('lit l’id du compte dans le cookie twid', () => {
    expect(parseTwid('u%3D1234567890')).toBe('1234567890');
    expect(parseTwid('"u=42"')).toBe('42');
    expect(parseTwid(undefined)).toBeUndefined();
  });
});
