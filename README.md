# futtarns

Friday food ordering for our group, running at [freitach.arns.dev](https://freitach.arns.dev).

Every Friday someone hosts, everyone else says whether they come, picks a dish from the
restaurant of the week (or pays the flat price of a barbecue), pays up front via PayPal,
and the host places one order on Lieferando. A WhatsApp bot does the chasing.

## What it does

- **Login by phone number**: enter your number, get a six-digit code on WhatsApp. Personal
  login links remain as a fallback.
- **Friday page**: answer (in / comes but doesn't eat / out), pick dishes with sizes and
  extras, order for guests, see who eats what and what it costs.
- **Default dish per restaurant**: whoever says nothing counts as in and gets their default
  when ordering closes at 19:00. The order goes out at 19:30, food arrives around 20:30.
- **Money**: own dishes plus an equal share of fees (or of a discount). Pay up front with a
  PayPal.me link that has the amount filled in, plus an optional drinks donation with
  suggested amounts. After the order the host enters the real total and the split is
  corrected; reminders follow until everyone has paid.
- **Flat-price Fridays** such as a barbecue: one price per person, no menu.
- **Calendar**: who hosts (substitutes per Friday), cancelled Fridays, everyone's absences,
  and an iCal feed for the phone calendar.
- **Restaurants**: fees, minimum order, menus pasted from Lieferando with a preview.
- **WhatsApp bot**: invitations on Wednesday, order reminders on Friday afternoon, the order
  list for the host at 19:00, the settled amounts and daily payment reminders. People can
  answer with `1`, `2`, `3`, `bezahlt`, `status` or `code`.

## Screenshots

| Login                                    | Friday                                   | Dish                                        | Calendar                           |
| ---------------------------------------- | ---------------------------------------- | ------------------------------------------- | ---------------------------------- |
| ![](docs/screenshots/login-1-nummer.png) | ![](docs/screenshots/freitag-1-oben.png) | ![](docs/screenshots/freitag-3-gericht.png) | ![](docs/screenshots/kalender.png) |

## Development

```bash
pnpm install
pnpm seed        # demo group, restaurants and Fridays in an embedded database (.data/)
pnpm dev         # http://localhost:3000/login – the code is shown on the page without a bot
```

Without `DATABASE_URL` the app uses an embedded PGlite database, and without `BOT_URL` every
WhatsApp message is printed to the console instead of being sent.

| Command                                                            |                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------ |
| `pnpm test`                                                        | unit and database tests (Vitest, in-memory PGlite)                 |
| `pnpm lint` / `pnpm typecheck` / `pnpm format:check`               | the checks CI runs                                                 |
| `pnpm db:generate --name <change>`                                 | a new migration after editing `lib/db/schema.ts`                   |
| `pnpm member:create --name … --phone … [--admin] [--default-host]` | add someone from the shell                                         |
| `node scripts/screenshots.mjs [dir]`                               | screenshots of the main screens (needs `pnpm seed` and `pnpm dev`) |

## Docs

- [Architecture](docs/architecture.md): data model, the Friday lifecycle, money, reminders.
- [Deployment](docs/deployment.md): the Docker stack, DNS, pairing the WhatsApp bot.
- [Design](docs/design.md): how the park.fan look is reproduced.
