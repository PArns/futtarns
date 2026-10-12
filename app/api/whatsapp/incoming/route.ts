import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { getDb } from '@/lib/db';
import { normalizePhone } from '@/lib/phone';
import { handleIncoming } from '@/lib/services/incoming';

function authorized(request: Request): boolean {
  const expected = process.env.BOT_TOKEN;
  if (!expected) return false;
  const given = request.headers.get('authorization')?.replace(/^Bearer /, '') ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const body = z.object({ from: z.string().max(40), text: z.string().max(2000) });

/** Called by the bot for every direct message; the bot sends back whatever `reply` says. */
export async function POST(request: Request) {
  if (!authorized(request)) return Response.json({ error: 'unauthorized' }, { status: 401 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: 'bad request' }, { status: 400 });
  const phone = normalizePhone(parsed.data.from);
  if (!phone) return Response.json({ reply: null });
  const reply = await handleIncoming(await getDb(), phone, parsed.data.text, new Date());
  return Response.json({ reply });
}
