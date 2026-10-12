/**
 * Container entry point: runs the web app and the WhatsApp bot side by side, so the whole
 * thing is one image. The bot is restarted if it dies; if the app dies the container
 * exits and the orchestrator restarts it. Set WHATSAPP=off to run without the bot.
 */
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';

const env = { ...process.env };
// App and bot only talk to each other on localhost; a fresh secret per start is enough.
env.BOT_TOKEN ||= randomBytes(32).toString('hex');
env.APP_INTERNAL_URL ||= `http://127.0.0.1:${env.PORT || 3000}`;
const botEnabled = env.WHATSAPP !== 'off';
const botPort = env.BOT_PORT || '3001';
if (botEnabled) env.BOT_URL ||= `http://127.0.0.1:${botPort}`;

let stopping = false;
let bot = null;

function startBot() {
  bot = spawn('node', ['src/index.ts'], {
    cwd: '/opt/bot/bot',
    env: { ...env, PORT: botPort },
    stdio: 'inherit',
  });
  bot.on('exit', (code) => {
    if (stopping) return;
    console.error(`[start] bot exited (${code}), restarting in 5 s`);
    setTimeout(startBot, 5_000);
  });
}

const app = spawn('node', ['server.js'], { cwd: '/app', env, stdio: 'inherit' });
app.on('exit', (code) => {
  stopping = true;
  bot?.kill('SIGTERM');
  process.exit(code ?? 1);
});
if (botEnabled) startBot();

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, () => {
    stopping = true;
    bot?.kill(signal);
    app.kill(signal);
  });
}
