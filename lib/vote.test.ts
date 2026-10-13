import { describe, expect, it } from 'vitest';
import { optionForLetter, standings, voteLetter, voteWinner, votingAt } from '@/lib/vote';

const vote = (memberId: number, restaurantId: number) => ({ memberId, restaurantId });

describe('voteWinner', () => {
  it('keeps the current restaurant without votes or on a tie', () => {
    expect(voteWinner([], 1)).toBe(1);
    expect(voteWinner([vote(1, 2), vote(2, 3)], 1)).toBe(1);
  });

  it('gives the most votes the win, even against the current one', () => {
    expect(voteWinner([vote(1, 2), vote(2, 2), vote(3, 1)], 1)).toBe(2);
    expect(voteWinner([vote(1, 2)], null)).toBe(2);
  });
});

describe('the ballot', () => {
  const options = [
    { id: 7, name: 'Bella Napoli' },
    { id: 9, name: 'Sakura Sushi' },
  ];

  it('maps letters to options either way round', () => {
    expect(voteLetter(1)).toBe('B');
    expect(optionForLetter(options, 'b')).toEqual(options[1]);
    expect(optionForLetter(options, 'C')).toBeNull();
    expect(optionForLetter(options, 'ab')).toBeNull();
  });

  it('lists who voted for what, the most first', () => {
    const names = ['', 'Anna', 'Ben', 'Clara'];
    expect(standings(options, [vote(1, 9), vote(2, 9), vote(3, 7)], (id) => names[id]!)).toEqual([
      'Sakura Sushi 2 (Anna, Ben)',
      'Bella Napoli 1 (Clara)',
    ]);
  });
});

describe('votingAt', () => {
  const friday = {
    date: '2026-10-16',
    mode: 'delivery' as const,
    cancelled: false,
    restaurantChosen: false,
    voteClosed: false,
  };

  it('runs until Thursday 23:59 unless the host picked a restaurant', () => {
    expect(votingAt(friday, new Date('2026-10-15T21:59:00Z'))).toBe(true);
    expect(votingAt(friday, new Date('2026-10-15T22:00:00Z'))).toBe(false);
    expect(votingAt({ ...friday, restaurantChosen: true }, new Date('2026-10-14T10:00:00Z'))).toBe(
      false
    );
    expect(votingAt({ ...friday, mode: 'flat' }, new Date('2026-10-14T10:00:00Z'))).toBe(false);
  });
});
