const INTERVAL_MS = 60_000;

/**
 * Starts the reminder loop inside the server process. It is idempotent per message, so a
 * second replica or a restart cannot double-send; `SCHEDULER=off` disables it.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== 'nodejs' || process.env.SCHEDULER === 'off') return;
  const { getDb } = await import('@/lib/db');
  const { runScheduler } = await import('@/lib/services/scheduler');
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runScheduler(await getDb(), new Date());
    } catch (error) {
      console.error('[scheduler]', error);
    } finally {
      running = false;
    }
  };
  setInterval(tick, INTERVAL_MS).unref();
  setTimeout(tick, 5_000).unref();
}
