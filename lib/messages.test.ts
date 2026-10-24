import { afterEach, describe, expect, it } from 'vitest';
import { pick, pinWording } from '@/lib/messages';

describe('pick', () => {
  afterEach(() => pinWording());

  it('picks the same wording for the same message, and varies across people', () => {
    pinWording(false);
    const wordings = ['a', 'b', 'c'] as const;
    expect(pick(wordings, 'due:2026-10-16:2')).toBe(pick(wordings, 'due:2026-10-16:2'));
    const picked = new Set(
      Array.from({ length: 30 }, (_, id) => pick(wordings, `due:2026-10-16:${id}`))
    );
    expect(picked).toEqual(new Set(wordings));
  });

  it('says the first wording while tests pin it', () => {
    expect(pick(['first', 'second'], 'anything')).toBe('first');
  });
});
