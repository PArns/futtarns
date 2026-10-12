/**
 * Creates a member from the command line and prints their login link; the way the first
 * admin gets in. Usage:
 *   pnpm member:create --name Patrick --phone "0170 1234567" --admin --default-host
 */
import { parseArgs } from 'node:util';
import { loginLink } from '@/lib/auth-tokens';
import { migrateDb, openDb } from '@/lib/db/client';
import { normalizePhone } from '@/lib/phone';
import { createMember } from '@/lib/services/members';

const { values } = parseArgs({
  options: {
    name: { type: 'string' },
    phone: { type: 'string' },
    admin: { type: 'boolean', default: false },
    'default-host': { type: 'boolean', default: false },
  },
});

if (!values.name) {
  console.error(
    'Usage: pnpm member:create --name <Name> --phone <Nummer> [--admin] [--default-host]'
  );
  process.exit(1);
}
const phone = values.phone ? normalizePhone(values.phone) : null;
if (values.phone && !phone) {
  console.error(`"${values.phone}" is not a phone number`);
  process.exit(1);
}

const url = process.env.DATABASE_URL || '.data/pglite';
const { db, close } = await openDb(url);
await migrateDb(db, url);
const { member, loginToken } = await createMember(
  db,
  { name: values.name, phone, isAdmin: values.admin, isDefaultHost: values['default-host'] },
  null
);
console.log(`Created ${member.name} (#${member.id}).\nLogin link: ${loginLink(loginToken)}`);
await close();
