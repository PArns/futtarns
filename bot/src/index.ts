/**
 * The WhatsApp side of freitach: a linked device (Baileys) with a tiny HTTP API. The app
 * calls POST /send; every direct message the bot receives is forwarded to the app, and
 * the app's answer is sent back. The bot keeps no state of its own besides the login.
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { mkdir, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket,
} from 'baileys';
import pino from 'pino';
import QRCode from 'qrcode';

const PORT = Number(process.env.PORT ?? 3001);
const AUTH_DIR = process.env.AUTH_DIR ?? './data/auth';
const BOT_TOKEN = process.env.BOT_TOKEN ?? '';
const APP_URL = (process.env.APP_INTERNAL_URL ?? 'http://localhost:3000').replace(/\/$/, '');
/** WhatsApp wants the number as digits with the country code; a German 0170 … works too. */
function pairingDigits(raw: string | null | undefined): string | null {
  const digits = raw?.replace(/\D/g, '') ?? '';
  if (!digits) return null;
  if (digits.startsWith('00')) return digits.slice(2);
  if (digits.startsWith('0')) return `49${digits.slice(1)}`;
  return digits;
}

const PAIRING_PHONE = pairingDigits(process.env.PAIRING_PHONE);
// A relink from the app may ask for a pairing code for another number than PAIRING_PHONE.
let pairingPhone = PAIRING_PHONE;

if (!BOT_TOKEN) {
  console.error('BOT_TOKEN is required');
  process.exit(1);
}

const logger = pino({ level: process.env.LOG_LEVEL ?? 'warn' });

let socket: WASocket | null = null;
let connected = false;
let pendingQr: string | null = null;
let pairingCode: string | null = null;
// The number the current pairing code is for, so the app can say which phone to use.
let pairingCodeFor: string | null = null;
// WhatsApp closes an unlinked connection after about two and a half minutes. Instead of
// opening the next one at once, which sends the phone a notification each time, the bot
// waits until the people page asks for a new code.
let linkingPaused = false;

function phoneToJid(to: string): string {
  if (to.includes('@')) return to;
  return `${to.replace(/\D/g, '')}@s.whatsapp.net`;
}

/** The sender's phone number in E.164, also when WhatsApp addresses them by a LID. */
async function senderPhone(message: WAMessage): Promise<string | null> {
  const key = message.key;
  const candidates = [key.remoteJid, key.remoteJidAlt].filter((jid): jid is string => Boolean(jid));
  for (const jid of candidates) {
    if (jid.endsWith('@s.whatsapp.net')) return `+${jid.split('@')[0]!.split(':')[0]}`;
  }
  const lid = candidates.find((jid) => jid.endsWith('@lid'));
  if (lid && socket) {
    const pn = await socket.signalRepository.lidMapping.getPNForLID(lid).catch(() => null);
    if (pn) return `+${pn.split('@')[0]!.split(':')[0]}`;
  }
  return null;
}

function textOf(message: WAMessage): string | null {
  const content = message.message;
  return content?.conversation ?? content?.extendedTextMessage?.text ?? null;
}

async function forward(phone: string, text: string): Promise<string | null> {
  const response = await fetch(`${APP_URL}/api/whatsapp/incoming`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${BOT_TOKEN}` },
    body: JSON.stringify({ from: phone, text }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`app answered ${response.status}`);
  const body = (await response.json()) as { reply?: string | null };
  return body.reply ?? null;
}

async function connect(): Promise<void> {
  let { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  // Asking for a pairing code stores `me` before anything is linked; `account` only comes
  // with a successful pairing. With `me` alone the next connection would try to log in as a
  // device WhatsApp never accepted, and no code would work again.
  if (state.creds.me && !state.creds.account) {
    await clearAuth();
    ({ state, saveCreds } = await useMultiFileAuthState(AUTH_DIR));
  }
  const { version } = await fetchLatestBaileysVersion();
  const sock = makeWASocket({
    version,
    auth: state,
    logger,
    // Baileys only allows a custom browser name for QR codes; a pairing code is refused
    // unless the bot shows up as a real browser.
    browser: pairingPhone ? Browsers.macOS('Chrome') : Browsers.ubuntu('freitach'),
    markOnlineOnConnect: false,
    syncFullHistory: false,
  });
  socket = sock;

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', async (update) => {
    // A socket replaced by a relink must not reconnect or wipe the new one's login.
    if (sock !== socket) return;
    if (update.qr) {
      pendingQr = update.qr;
      if (pairingPhone && !sock.authState.creds.registered && !pairingCode) {
        const phone = pairingPhone;
        pairingCode = await sock.requestPairingCode(phone).catch((error: unknown) => {
          console.error('Could not request a pairing code', error);
          return null;
        });
        pairingCodeFor = pairingCode ? phone : null;
        if (pairingCode) console.log(`Pairing code for +${phone}: ${pairingCode}`);
      } else if (!pairingPhone) {
        console.log('Not linked yet: open /qr?token=… or set PAIRING_PHONE for a pairing code.');
      }
    }
    if (update.connection === 'open') {
      connected = true;
      pendingQr = null;
      pairingCode = null;
      console.log(`Connected as ${sock.user?.id ?? 'unknown'}`);
      // Group ids only go to the log, which only whoever runs the server can read.
      sock
        .groupFetchAllParticipating()
        .then((groups) => {
          const lines = Object.values(groups).map((group) => `  ${group.subject}: ${group.id}`);
          if (lines.length)
            console.log(`Groups (one id goes into WHATSAPP_GROUP):\n${lines.join('\n')}`);
        })
        .catch((error: unknown) => console.error('Could not list groups', error));
    }
    if (update.connection === 'close') {
      connected = false;
      // A code or QR code belongs to the connection that asked for it.
      pendingQr = null;
      pairingCode = null;
      const status = (
        update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined
      )?.output?.statusCode;
      if (status === DisconnectReason.loggedOut) {
        // The old login is useless now; start over so a new QR code shows up in the app.
        console.error('Logged out from WhatsApp, waiting to be linked again.');
        await clearAuth();
        setTimeout(() => void connect(), 2_000);
        return;
      }
      // `account` is only set by a successful pairing (QR or code).
      if (status === DisconnectReason.timedOut && !sock.authState.creds.account) {
        linkingPaused = true;
        console.log('Linking timed out; the people page asks for a new code when it is opened.');
        return;
      }
      console.warn(`Connection closed (${status ?? 'unknown'}), reconnecting`);
      setTimeout(() => void connect(), 3_000);
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' || sock !== socket) return;
    for (const message of messages) {
      const jid = message.key.remoteJid ?? '';
      if (message.key.fromMe || jid.endsWith('@g.us') || jid === 'status@broadcast') continue;
      const text = textOf(message);
      if (!text) continue;
      try {
        const phone = await senderPhone(message);
        // Whoever the bot cannot place gets no answer, like any number the app doesn't know.
        if (!phone) continue;
        const reply = await forward(phone, text);
        if (reply) await sock.sendMessage(jid, { text: reply }, { quoted: message });
      } catch (error) {
        console.error('Could not handle a message', error);
      }
    }
  });
}

/**
 * Deletes the stored login. AUTH_DIR is usually a mounted volume, which can be emptied but
 * not removed: removing it fails with EBUSY.
 */
async function clearAuth(): Promise<void> {
  await mkdir(AUTH_DIR, { recursive: true });
  for (const name of await readdir(AUTH_DIR)) {
    await rm(join(AUTH_DIR, name), { recursive: true, force: true });
  }
}

/**
 * Logs the linked phone out and starts over, so another number can be linked: with a
 * pairing code for `phone` if given, otherwise with a QR code.
 */
async function relink(phone: string | null): Promise<void> {
  const old = socket;
  socket = null;
  connected = false;
  pendingQr = null;
  pairingCode = null;
  linkingPaused = false;
  pairingPhone = phone ?? PAIRING_PHONE;
  if (old) {
    await old.logout().catch((error: unknown) => console.warn('Logout failed', error));
    try {
      old.end(undefined);
    } catch {
      // Already closed by the logout.
    }
  }
  await clearAuth();
  console.log(
    pairingPhone ? `Relinking with a pairing code for +${pairingPhone}` : 'Relinking with a QR code'
  );
  setTimeout(() => void connect(), 1_000);
}

function authorized(request: IncomingMessage, url: URL): boolean {
  const given =
    request.headers.authorization?.replace(/^Bearer /, '') ?? url.searchParams.get('token') ?? '';
  const a = Buffer.from(given);
  const b = Buffer.from(BOT_TOKEN);
  return a.length === b.length && timingSafeEqual(a, b);
}

function json(response: ServerResponse, status: number, body: unknown) {
  response.writeHead(status, { 'Content-Type': 'application/json' });
  response.end(JSON.stringify(body));
}

const MAX_BODY_BYTES = 64 * 1024;

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error('request body too large');
    chunks.push(chunk as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}');
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', 'http://bot');
  try {
    if (url.pathname === '/health')
      return json(response, 200, {
        connected,
        linked: Boolean(socket?.authState.creds.registered),
        // `491701234567:12@s.whatsapp.net` → the number the bot sends from, for the app only.
        number:
          connected && authorized(request, url)
            ? (socket?.user?.id.split(/[:@]/)[0] ?? null)
            : null,
      });
    if (!authorized(request, url)) return json(response, 401, { error: 'unauthorized' });

    if (request.method === 'POST' && url.pathname === '/send') {
      const body = (await readJson(request)) as { to?: string; text?: string };
      if (!body.to || !body.text) return json(response, 400, { error: 'to and text are required' });
      if (!socket || !connected) return json(response, 503, { error: 'not connected' });
      await socket.sendMessage(phoneToJid(body.to), { text: body.text });
      return json(response, 200, { ok: true });
    }

    if (request.method === 'POST' && url.pathname === '/relink') {
      const body = (await readJson(request)) as { phone?: string | null };
      await relink(pairingDigits(body.phone));
      return json(response, 200, { ok: true });
    }

    if (request.method === 'GET' && url.pathname === '/qr') {
      if (connected) return json(response, 200, { linked: true });
      if (linkingPaused) {
        linkingPaused = false;
        void connect();
      }
      if (pairingCode) return json(response, 200, { pairingCode, phone: pairingCodeFor });
      if (!pendingQr)
        return json(response, 404, { error: 'no QR yet, try again in a few seconds' });
      response.writeHead(200, { 'Content-Type': 'image/svg+xml' });
      return response.end(await QRCode.toString(pendingQr, { type: 'svg', margin: 2 }));
    }

    json(response, 404, { error: 'not found' });
  } catch (error) {
    console.error(error);
    json(response, 500, { error: 'internal error' });
  }
});

// Only the app in the same container talks to the bot.
server.listen(PORT, '127.0.0.1', () => console.log(`Bot API on 127.0.0.1:${PORT}`));
void connect();
