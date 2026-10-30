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
    ['später', { kind: 'late', arrivesAt: null }],
    ['Ich komm später!', { kind: 'late', arrivesAt: null }],
    ['später 21', { kind: 'late', arrivesAt: '21:00' }],
    ['Komme später gegen 21:30 Uhr', { kind: 'late', arrivesAt: '21:30' }],
    ['später um 22.15', { kind: 'late', arrivesAt: '22:15' }],
    ['doch pünktlich', { kind: 'onTime' }],
    ['andere', { kind: 'others' }],
    ['Ich übernehme!', { kind: 'takeOver' }],
    ['Hab bezahlt', { kind: 'paid' }],
    ['Code', { kind: 'login' }],
    ['?', { kind: 'status' }],
    ['hilfe', { kind: 'help' }],
    ['1E', { kind: 'answerVote', status: 'in', letter: 'e', confirmed: false }],
    ['1 E', { kind: 'answerVote', status: 'in', letter: 'e', confirmed: false }],
    ['E1', { kind: 'answerVote', status: 'in', letter: 'e', confirmed: false }],
    ['e 1', { kind: 'answerVote', status: 'in', letter: 'e', confirmed: false }],
    ['1, b!', { kind: 'answerVote', status: 'in', letter: 'b', confirmed: false }],
    ['2B', { kind: 'answerVote', status: 'nofood', letter: 'b', confirmed: false }],
    ['2b sicher', { kind: 'answerVote', status: 'nofood', letter: 'b', confirmed: true }],
    ['3E', { kind: 'unknown' }],
    ['Was geht', { kind: 'unknown' }],
  ])('reads %s', (text, command) => expect(parseCommand(text)).toEqual(command));
});
