import { describe, expect, it } from 'vitest';
import { buildCalendar } from '@/lib/ical';

describe('buildCalendar', () => {
  it('writes escaped, folded events', () => {
    const text = buildCalendar(
      'freitach',
      [
        {
          uid: 'friday-2026-10-16@freitach',
          start: new Date('2026-10-16T17:00:00Z'),
          end: new Date('2026-10-16T21:00:00Z'),
          summary: 'Freitach: Pizza, bei Patrick\r\nX-INJECTED:1',
          description: 'Bestellschluss 19:00; Essen ~20:30. '.repeat(4),
          cancelled: true,
        },
      ],
      new Date('2026-10-12T10:00:00Z')
    );
    expect(text).toContain('DTSTART:20261016T170000Z');
    expect(text).toContain('SUMMARY:Freitach: Pizza\\, bei Patrick\\nX-INJECTED:1');
    expect(text).not.toMatch(/^X-INJECTED/m);
    expect(text).toContain('STATUS:CANCELLED');
    for (const line of text.split('\r\n')) {
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    }
  });
});
