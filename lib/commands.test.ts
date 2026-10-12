import { describe, expect, it } from 'vitest';
import { parseCommand } from '@/lib/commands';

describe('parseCommand', () => {
  it.each([
    ['1', { kind: 'answer', status: 'in' }],
    ['Bin dabei!', { kind: 'answer', status: 'in' }],
    ['2', { kind: 'answer', status: 'nofood' }],
    ['ohne Essen', { kind: 'answer', status: 'nofood' }],
    ['3', { kind: 'answer', status: 'out' }],
    ['Nein.', { kind: 'answer', status: 'out' }],
    ['Hab bezahlt', { kind: 'paid' }],
    ['Code', { kind: 'login' }],
    ['?', { kind: 'status' }],
    ['hilfe', { kind: 'help' }],
    ['Was geht', { kind: 'unknown' }],
  ])('reads %s', (text, command) => expect(parseCommand(text)).toEqual(command));
});
