import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';
import type { Db } from '@/lib/db/client';
import { members, type Member } from '@/lib/db/schema';
import {
  createMcpToken,
  findMemberByMcpToken,
  listMcpTokens,
  MCP_TOKENS_PER_MEMBER,
  revokeMcpToken,
} from '@/lib/services/auth';
import { chatOf } from '@/lib/services/chats';
import { clearHost, loadFriday, setAttendance, setRestaurant } from '@/lib/services/fridays';
import { handleIncoming } from '@/lib/services/incoming';
import { handleMcpRequest } from '@/lib/services/mcp';
import { callTool, type ToolContext } from '@/lib/services/mcp-tools';
import { createMember } from '@/lib/services/members';
import { addItem } from '@/lib/services/orders';
import { createDish, createRestaurant, listDishes } from '@/lib/services/restaurants';
import { Interpretation, PROMPT_VERSION } from '@/lib/assistant';
import { createTestDb } from '@/test/db';

const FRIDAY = '2026-10-16';
// Friday 14:00 in Berlin: still open, and with one restaurant there is no vote.
const NOW = new Date('2026-10-16T12:00:00Z');

let db: Db;
let close: () => Promise<void>;
let sent: { to: string; text: string }[];
const send = async (to: string, text: string) => {
  sent.push({ to, text });
  return 'sent' as const;
};

async function setup() {
  const patrick = (
    await createMember(
      db,
      { name: 'Patrick', phone: '+491701111111', isAdmin: true, isDefaultHost: true },
      null
    )
  ).member;
  const anna = (await createMember(db, { name: 'Anna', phone: '+491702222222' }, null)).member;
  const ben = (await createMember(db, { name: 'Ben', phone: '+491703333333' }, null)).member;
  const gast = (await createMember(db, { name: 'Gast', phone: '+491704444444', core: false }, null))
    .member;
  const restaurant = await createRestaurant(db, {
    name: 'Bella Napoli',
    cuisine: 'Pizza',
    lieferandoUrl: null,
    minOrderCents: 0,
    deliveryFeeCents: 300,
    freeDeliveryFromCents: null,
    serviceFeeCents: 0,
    notes: null,
  });
  await createDish(db, restaurant.id, {
    category: 'Pizza',
    name: 'Margherita',
    description: null,
    priceCents: 900,
    optionGroups: [
      {
        id: 'groesse',
        name: 'Größe',
        min: 1,
        max: 1,
        choices: [
          { id: 'normal', name: 'Normal', priceCents: 0 },
          { id: 'gross', name: 'Groß', priceCents: 200 },
        ],
      },
    ],
  });
  const [dish] = await listDishes(db, restaurant.id);
  await setRestaurant(db, FRIDAY, restaurant.id);
  return { patrick, anna, ben, gast, restaurant, dish: dish! };
}

const as = (member: Member, now = NOW): ToolContext => ({ db, member, now, send });

beforeEach(async () => {
  ({ db, close } = await createTestDb());
  sent = [];
});

afterEach(async () => {
  await close();
});

describe('MCP keys', () => {
  it('works for its member only while they are active, and can be deleted', async () => {
    const { anna } = await setup();
    const { id, token } = await createMcpToken(db, anna.id, 'Claude Desktop', NOW);
    expect(token).toMatch(/^frt_mcp_/);
    expect((await findMemberByMcpToken(db, token, NOW))?.id).toBe(anna.id);
    expect(await findMemberByMcpToken(db, `${token}x`, NOW)).toBeNull();
    expect(await listMcpTokens(db, anna.id)).toEqual([
      { id, name: 'Claude Desktop', createdAt: NOW, lastUsedAt: NOW },
    ]);
    await db.update(members).set({ active: false }).where(eq(members.id, anna.id));
    expect(await findMemberByMcpToken(db, token, NOW)).toBeNull();
    await db.update(members).set({ active: true }).where(eq(members.id, anna.id));
    await revokeMcpToken(db, anna.id, id);
    expect(await findMemberByMcpToken(db, token, NOW)).toBeNull();
  });

  it('allows a handful per member, each with a name', async () => {
    const { anna } = await setup();
    await expect(createMcpToken(db, anna.id, '  ')).rejects.toThrow('Namen');
    for (let index = 0; index < MCP_TOKENS_PER_MEMBER; index++) {
      await createMcpToken(db, anna.id, `Schlüssel ${index}`);
    }
    await expect(createMcpToken(db, anna.id, 'noch einer')).rejects.toThrow('lösch erst');
  });
});

describe('the MCP endpoint', () => {
  const rpc = (token: string | null, body: unknown) =>
    new Request('http://localhost/api/mcp', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
        'mcp-protocol-version': '2025-06-18',
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
    });
  const call = async (token: string | null, method: string, params: unknown = {}) => {
    const response = await handleMcpRequest(
      db,
      rpc(token, { jsonrpc: '2.0', id: 1, method, params }),
      NOW,
      send
    );
    return { status: response.status, body: await response.json() };
  };

  it('turns away requests without a valid key', async () => {
    await setup();
    expect((await call(null, 'tools/list')).status).toBe(401);
    expect((await call('frt_mcp_nope', 'tools/list')).status).toBe(401);
  });

  it('introduces itself and lists only the tools the member may use', async () => {
    const { patrick, anna } = await setup();
    const annas = (await createMcpToken(db, anna.id, 'Test')).token;
    const patricks = (await createMcpToken(db, patrick.id, 'Test')).token;
    const init = await call(annas, 'initialize', {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'test', version: '1' },
    });
    expect(init.status).toBe(200);
    expect(init.body.result.serverInfo.name).toBe('freitach');
    expect(init.body.result.instructions).toContain('start with whoami');

    const names = async (token: string) =>
      (await call(token, 'tools/list')).body.result.tools.map(
        (tool: { name: string }) => tool.name
      );
    expect(await names(annas)).toContain('take_over');
    expect(await names(annas)).not.toContain('send_message');
    expect(await names(patricks)).toContain('send_message');
    const [whoami] = (await call(annas, 'tools/list')).body.result.tools;
    expect(whoami).toMatchObject({ name: 'whoami', annotations: { readOnlyHint: true } });
  });

  it('runs tools as the member and reports refusals as tool errors', async () => {
    const { anna, ben } = await setup();
    const token = (await createMcpToken(db, anna.id, 'Test')).token;
    const whoami = await call(token, 'tools/call', { name: 'whoami', arguments: {} });
    expect(JSON.parse(whoami.body.result.content[0].text)).toMatchObject({
      id: anna.id,
      name: 'Anna',
      roles: { admin: false, stammtruppe: true },
      this_friday: { date: FRIDAY, you_run_it: false },
    });
    const refused = await call(token, 'tools/call', {
      name: 'set_answer',
      arguments: { member_id: ben.id, status: 'out' },
    });
    expect(refused.body.result).toEqual({
      content: [{ type: 'text', text: 'Das darfst du nicht ändern.' }],
      isError: true,
    });
    const wrong = await call(token, 'tools/call', {
      name: 'set_answer',
      arguments: { status: 'vielleicht' },
    });
    expect(wrong.body.result?.isError ?? Boolean(wrong.body.error)).toBe(true);
  });
});

describe('the MCP tools', () => {
  it('shows a Friday, with everyone’s money only to whoever runs it', async () => {
    const { patrick, anna, ben, dish } = await setup();
    await addItem(db, FRIDAY, anna.id, {
      dishId: dish.id,
      selection: { groesse: ['gross'] },
      note: null,
      quantity: 1,
    });
    type Shown = {
      phase: string;
      host: { name: string };
      people: { name: string; items: { name: string }[]; money?: unknown }[];
    };
    const forBen = (await callTool(as(ben), 'get_friday')) as Shown;
    expect(forBen.phase).toBe('order');
    expect(forBen.host.name).toBe('Patrick');
    const annaForBen = forBen.people.find((entry) => entry.name === 'Anna')!;
    expect(annaForBen.items.map((item) => item.name)).toEqual(['Margherita']);
    expect(annaForBen.money).toBeUndefined();
    expect(forBen.people.find((entry) => entry.name === 'Ben')!.money).toBeDefined();
    const forHost = (await callTool(as(patrick), 'get_friday')) as Shown;
    expect(forHost.people.find((entry) => entry.name === 'Anna')!.money).toBeDefined();
  });

  it('answers and orders like the page: own until the deadline, others only for the host', async () => {
    const { patrick, anna, ben, dish } = await setup();
    await expect(
      callTool(as(anna), 'set_answer', { member_id: ben.id, status: 'out' })
    ).rejects.toThrow('nicht ändern');
    const ordered = await callTool(as(anna), 'order_dish', {
      dish_id: dish.id,
      choices: { groesse: ['normal'] },
    });
    expect(ordered).toMatchObject({ dish: 'Margherita', outcome: 'added', ordered_ahead: false });
    // Saying no throws the order away, so it wants a confirmation first.
    await expect(callTool(as(anna), 'set_answer', { status: 'nofood' })).rejects.toThrow(
      'confirm: true'
    );
    await callTool(as(anna), 'set_answer', { status: 'nofood', confirm: true });
    // The host (an admin here) may change anyone's answer.
    await callTool(as(patrick), 'set_answer', { member_id: ben.id, status: 'out' });
    const view = await loadFriday(db, FRIDAY, NOW);
    const statusOf = (id: number) =>
      view.participants.find((entry) => entry.member.id === id)!.attendance.status;
    expect([statusOf(anna.id), statusOf(ben.id)]).toEqual(['nofood', 'out']);
    // After the deadline only the host still changes orders.
    const late = new Date('2026-10-16T17:40:00Z');
    await expect(
      callTool(as(anna, late), 'order_dish', {
        dish_id: dish.id,
        choices: { groesse: ['normal'] },
      })
    ).rejects.toThrow('Bestellschluss');
  });

  it('takes a Friday over and says „Bin dabei“, which can be changed again', async () => {
    const { anna } = await setup();
    await clearHost(db, FRIDAY);
    await setAttendance(db, FRIDAY, anna.id, 'out', NOW);
    expect(await callTool(as(anna), 'take_over')).toMatchObject({
      host: { name: 'Anna' },
      status: 'in',
      status_before: 'out',
    });
    await callTool(as(anna), 'set_answer', { status: 'nofood' });
    const view = await loadFriday(db, FRIDAY, NOW);
    expect(view.host?.id).toBe(anna.id);
    expect(view.participants.find((entry) => entry.member.id === anna.id)!.attendance.status).toBe(
      'nofood'
    );
  });

  it('takes the Friday from the usual host while they are around, and tells them', async () => {
    const { patrick, ben } = await setup();
    expect(await callTool(as(ben), 'take_over')).toMatchObject({
      host: { name: 'Ben' },
      told: { id: patrick.id, name: 'Patrick' },
    });
    expect(sent.map((message) => message.to)).toEqual(['+491701111111']);
    await expect(callTool(as(patrick), 'take_over')).rejects.toThrow('weg ist');
  });

  it('sets hosts and cancels only with the page’s rights', async () => {
    const { patrick, anna, gast } = await setup();
    await expect(callTool(as(anna), 'set_host', { date: FRIDAY, host: anna.id })).rejects.toThrow(
      'Vertretungen'
    );
    await expect(
      callTool(as(anna), 'set_cancelled', { date: FRIDAY, cancelled: true })
    ).rejects.toThrow('nur der Gastgeber');
    await expect(
      callTool(as(patrick), 'set_host', { date: FRIDAY, host: gast.id })
    ).rejects.toThrow('Stammtruppe');
    expect(await callTool(as(patrick), 'set_host', { date: FRIDAY, host: anna.id })).toEqual({
      date: FRIDAY,
      host: { id: anna.id, name: 'Anna' },
    });
    // Anna hosts now, so she may call it off.
    await callTool(as(anna), 'set_cancelled', { date: FRIDAY, cancelled: true, reason: 'Urlaub' });
    expect((await loadFriday(db, FRIDAY, NOW)).cancelReason).toBe('Urlaub');
    expect(await callTool(as(patrick), 'set_host', { date: FRIDAY, host: 'none' })).toEqual({
      date: FRIDAY,
      host: null,
    });
    await expect(
      callTool(as(anna), 'set_host', { date: '2026-10-15', host: 'default' })
    ).rejects.toThrow('kein Freitag');
  });

  it('enters absences for oneself, and for others only as an admin', async () => {
    const { patrick, anna, ben } = await setup();
    await expect(
      callTool(as(anna), 'add_absence', { member_id: ben.id, from: FRIDAY, to: FRIDAY })
    ).rejects.toThrow('nur Admins');
    expect(
      await callTool(as(patrick), 'add_absence', { from: FRIDAY, to: '2026-10-18' })
    ).toMatchObject({ would_host: [FRIDAY] });
    await callTool(as(anna), 'add_absence', { from: FRIDAY, to: FRIDAY, note: 'Hochzeit' });
    type People = { name: string; phone?: string; absences: { id: number; note?: string }[] }[];
    const forBen = (await callTool(as(ben), 'list_people')) as People;
    const annaForBen = forBen.find((entry) => entry.name === 'Anna')!;
    expect(annaForBen.phone).toBeUndefined();
    expect(annaForBen.absences).toEqual([
      { id: annaForBen.absences[0]!.id, from: FRIDAY, to: FRIDAY },
    ]);
    await expect(
      callTool(as(ben), 'remove_absence', { absence_id: annaForBen.absences[0]!.id })
    ).rejects.toThrow('gibt es nicht');
    const forAdmin = (await callTool(as(patrick), 'list_people')) as People;
    expect(forAdmin.find((entry) => entry.name === 'Anna')).toMatchObject({
      phone: '+491702222222',
      absences: [{ note: 'Hochzeit' }],
    });
    await callTool(as(anna), 'remove_absence', { absence_id: annaForBen.absences[0]!.id });
  });

  it('shows admins the bot’s prompt and Claude’s readings, to rate and compare', async () => {
    const { patrick, anna } = await setup();
    const answer = Interpretation.parse({
      action: 'chat',
      letter: null,
      arrives_at: null,
      dish_id: null,
      restaurant_id: null,
      remind_group: null,
      member_ids: [],
      item_id: null,
      replace: null,
      from_date: null,
      to_date: null,
      options: [],
      changes: [],
      admin_note: '',
      reply: 'Pizza bei Patrick! 🍕',
    });
    await handleIncoming(db, '+491702222222', 'Was ist heute los?', NOW, send, async () => answer);
    await expect(callTool(as(anna), 'assistant_readings')).rejects.toThrow('gibt es nicht');
    const prompt = (await callTool(as(patrick), 'assistant_prompt')) as {
      prompt_version: string;
      system_prompt: string;
    };
    expect(prompt.prompt_version).toBe(PROMPT_VERSION);
    expect(prompt.system_prompt).toContain('freitach');
    type Listed = { readings: { id: number; action: string; reply: string; rating: null }[] };
    const listed = (await callTool(as(patrick), 'assistant_readings')) as Listed;
    expect(listed.readings).toMatchObject([
      { action: 'chat', reply: 'Pizza bei Patrick! 🍕', rating: null },
    ]);
    const id = listed.readings[0]!.id;
    expect(await callTool(as(patrick), 'assistant_reading', { id })).toMatchObject({
      message: 'Was ist heute los?',
      answer: 'Pizza bei Patrick! 🍕',
    });
    // The chat links the message to what Claude made of it.
    const chat = (await callTool(as(patrick), 'get_chat', { member_id: anna.id })) as {
      messages: { text: string; reading_id?: number }[];
    };
    expect(chat.messages[0]).toMatchObject({ text: 'Was ist heute los?', reading_id: id });
    await callTool(as(patrick), 'rate_assistant_reading', {
      id,
      rating: -1,
      note: 'Hätte die Bestellfrist nennen sollen',
    });
    expect(
      ((await callTool(as(patrick), 'assistant_readings', { rating: -1 })) as Listed).readings
    ).toHaveLength(1);
    expect(await callTool(as(patrick), 'assistant_stats')).toMatchObject({
      readings: 1,
      bad: 1,
      byAction: { chat: 1 },
      byVersion: [{ version: PROMPT_VERSION, readings: 1 }],
    });
  });

  it('lets admins read every chat and message people; everyone else only their own chat', async () => {
    const { patrick, anna, ben } = await setup();
    await handleIncoming(db, '+491702222222', '1', NOW, send);
    await handleIncoming(db, '+491703333333', 'status', NOW, send);
    await expect(callTool(as(ben), 'get_chat', { member_id: anna.id })).rejects.toThrow(
      'nur Admins'
    );
    expect(await callTool(as(ben), 'list_chats')).toMatchObject({
      chats: [{ member: { name: 'Ben' } }],
    });
    const chat = (await callTool(as(patrick), 'get_chat', { member_id: anna.id })) as {
      messages: { from: string; kind: string; text: string }[];
    };
    expect(chat.messages.map((message) => [message.from, message.kind])).toEqual([
      ['member', 'command'],
      ['bot', 'reply'],
    ]);
    await expect(
      callTool(as(ben), 'send_message', { member_id: anna.id, text: 'Hi' })
    ).rejects.toThrow('gibt es nicht');
    expect(
      await callTool(as(patrick), 'send_message', { member_id: anna.id, text: 'Erledigt!' })
    ).toEqual({ sent_to: { id: anna.id, name: 'Anna' } });
    expect(sent.at(-1)).toEqual({ to: '+491702222222', text: '💬 *Von Patrick:* Erledigt!' });
    expect((await chatOf(db, anna.id)).messages.at(-1)).toMatchObject({
      direction: 'out',
      kind: 'message',
      text: '💬 *Von Patrick:* Erledigt!',
    });
  });
});
