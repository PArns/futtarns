/**
 * Logs in with the seeded phone numbers (local development shows the code on the page)
 * and captures the main screens on a phone and a desktop.
 * Usage: node scripts/screenshots.mjs [outDir]   (needs `pnpm seed` and `pnpm dev`)
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.APP_URL || 'http://localhost:3000';
const OUT = process.argv[2] || 'docs/screenshots';
const PHONE = { width: 390, height: 844 };
const DESKTOP = { width: 1366, height: 900 };
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH || '/opt/pw-browsers/chromium',
});
const errors = [];

async function newPage(viewport, theme = 'dark') {
  const context = await browser.newContext({
    viewport,
    deviceScaleFactor: 2,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
  });
  await context.addInitScript((value) => {
    try {
      localStorage.setItem('theme', value);
    } catch {}
  }, theme);
  const page = await context.newPage();
  page.on('pageerror', (error) => errors.push(`${page.url()}: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`${page.url()}: ${message.text()}`);
  });
  return page;
}

async function shot(page, name, fullPage = false) {
  await page.waitForTimeout(1200);
  await page.screenshot({ path: join(OUT, `${name}.png`), fullPage });
  console.log(`  ${name}.png`);
}

async function login(page, phone, capture) {
  await page.goto(`${BASE}/login`);
  await page.getByLabel('Handynummer').fill(phone);
  if (capture) await shot(page, `${capture}-1-nummer`);
  await page.getByRole('button', { name: 'Code per WhatsApp schicken' }).click();
  const info = page.getByText(/dein Code ist \d{6}/);
  await info.waitFor();
  const code = (await info.textContent()).match(/\d{6}/)[0];
  if (capture) await shot(page, `${capture}-2-code`);
  await page.getByLabel('Code').fill(code);
  await page.waitForURL(`${BASE}/`);
}

console.log(`Writing to ${OUT}`);

const anna = await newPage(PHONE);
await login(anna, '0170 2222222', 'login');
await shot(anna, 'freitag-1-oben');
await shot(anna, 'freitag-2-ganz', true);
await anna.getByRole('button', { name: /Funghi/ }).click();
await anna.getByRole('button', { name: /Groß 32 cm/ }).click();
await anna.getByRole('button', { name: /^Champignons/ }).click();
await shot(anna, 'freitag-3-gericht');
await anna.getByRole('button', { name: /^Bestellen/ }).click();
await anna.waitForTimeout(800);
await anna.goto(`${BASE}/`);
await shot(anna, 'freitag-4-bezahlen');
const nextFriday = await anna.getByRole('link', { name: 'Nächster Freitag' }).getAttribute('href');
await anna.goto(`${BASE}${nextFriday}`);
await shot(anna, 'grillen', true);
await anna.goto(`${BASE}/kalender`);
await shot(anna, 'kalender', true);
await anna.goto(`${BASE}/restaurants`);
await shot(anna, 'restaurants', true);
await anna.goto(`${BASE}/restaurants/1`);
await shot(anna, 'restaurant', true);
await anna.goto(`${BASE}/ich`);
await shot(anna, 'profil', true);

const patrick = await newPage(PHONE);
await login(patrick, '+49 170 1111111');
await shot(patrick, 'gastgeber', true);
await patrick.goto(`${BASE}/leute`);
await shot(patrick, 'leute', true);

const light = await newPage(PHONE, 'light');
await login(light, '0170 4444444');
await shot(light, 'hell', true);

const desktop = await newPage(DESKTOP);
await login(desktop, '0170 5555555');
await shot(desktop, 'desktop', true);

await browser.close();
if (errors.length) {
  console.error('\nBrowser errors:\n' + errors.join('\n'));
  process.exitCode = 1;
}
