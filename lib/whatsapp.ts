/**
 * Talks to the bot container. Without `BOT_URL` (local development) messages are only
 * logged, so every flow can be tried without a paired phone.
 */
export type SendResult = 'sent' | 'logged' | 'failed';

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
    console.error(`[whatsapp] send to ${to} failed`, error);
    return 'failed';
  }
}
