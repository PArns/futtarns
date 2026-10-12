/**
 * Talks to the bot container. Without `BOT_URL` (local development) messages are only
 * logged, so every flow can be tried without a paired phone.
 */
/**
 * `failed`: the bot said no (e.g. not connected), safe to retry. `unknown`: no answer in
 * time; the message may have gone out, so retrying could send it twice.
 */
export type SendResult = 'sent' | 'logged' | 'failed' | 'unknown';

export function whatsappConfigured(): boolean {
  return Boolean(process.env.BOT_URL);
}

export async function sendWhatsApp(to: string, text: string): Promise<SendResult> {
  const url = process.env.BOT_URL;
  if (!url) {
    console.info(`[whatsapp → ${to}]\n${text}`);
    return 'logged';
  }
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/send`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env.BOT_TOKEN ?? ''}`,
      },
      body: JSON.stringify({ to, text }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) {
      console.error(`[whatsapp] send to ${to} failed: ${response.status} ${await response.text()}`);
      return 'failed';
    }
    return 'sent';
  } catch (error) {
    console.error(`[whatsapp] send to ${to} got no answer`, error);
    return 'unknown';
  }
}

export type BotState =
  | { kind: 'off' }
  | { kind: 'unreachable' }
  | { kind: 'connected' }
  | { kind: 'linking'; qrSvg: string | null; pairingCode: string | null };

async function botFetch(path: string) {
  const url = process.env.BOT_URL!.replace(/\/$/, '');
  return fetch(`${url}${path}`, {
    headers: { Authorization: `Bearer ${process.env.BOT_TOKEN ?? ''}` },
    signal: AbortSignal.timeout(5_000),
    cache: 'no-store',
  });
}

/** Whether the bot is linked to WhatsApp, and if not, what to scan or type to link it. */
export async function botState(): Promise<BotState> {
  if (!process.env.BOT_URL) return { kind: 'off' };
  try {
    const health = (await (await botFetch('/health')).json()) as { connected: boolean };
    if (health.connected) return { kind: 'connected' };
    const response = await botFetch('/qr');
    if (response.headers.get('content-type')?.includes('svg')) {
      return { kind: 'linking', qrSvg: await response.text(), pairingCode: null };
    }
    const body = (await response.json().catch(() => ({}))) as {
      pairingCode?: string;
      linked?: boolean;
    };
    if (body.linked) return { kind: 'connected' };
    return { kind: 'linking', qrSvg: null, pairingCode: body.pairingCode ?? null };
  } catch {
    return { kind: 'unreachable' };
  }
}

/** The groups the bot is in, for picking WHATSAPP_GROUP. */
export async function botGroups(): Promise<{ id: string; subject: string; size: number }[]> {
  if (!process.env.BOT_URL) return [];
  try {
    const response = await botFetch('/groups');
    return response.ok
      ? ((await response.json()) as { id: string; subject: string; size: number }[])
      : [];
  } catch {
    return [];
  }
}
