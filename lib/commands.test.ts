import { describe, expect, it } from 'vitest';
import { parseCommand } from '@/lib/commands';

describe('parseCommand', () => {
  it.each([
    ['1', { kind: 'answer', status: 'in', confirmed: false }],
    ['Bin dabei!', { kind: 'answer', status: 'in', confirmed: false }],
    ['2', { kind: 'answer', status: 'nofood', confirmed: false }],
    ['ohne Essen', { kind: 'answer', status: 'nofood', confirmed: false }],
    ['3', { kind: 'answer', status: 'out', confirmed: false }],
    ['Nein.', { kind: 'answer', status: 'out', confirmed: false }],
    ['3 sicher', { kind: 'answer', status: 'out', confirmed: true }],
    ['Wie immer!', { kind: 'usual' }],
    ['Gleiches!', { kind: 'same' }],
    ['das Gleiche', { kind: 'same' }],
    ['wie letztes Mal', { kind: 'same' }],
    ['andere', { kind: 'others' }],
    ['Hab bezahlt', { kind: 'paid' }],
    ['Code', { kind: 'login' }],
    ['?', { kind: 'status' }],
    ['hilfe', { kind: 'help' }],
    ['Was geht', { kind: 'unknown' }],
  ])('reads %s', (text, command) => expect(parseCommand(text)).toEqual(command));
});
