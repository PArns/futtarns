# Architecture

Two processes in one container (`scripts/start.mjs`), one database:

- **app** (`/`): Next.js 16, App Router, server actions. Owns all logic and the database
  (Postgres via Drizzle; PGlite locally and in tests). A one-minute scheduler runs inside
  the server process (`instrumentation.ts` → `lib/services/scheduler.ts`).
- **bot** (`bot/`): a WhatsApp linked device (Baileys) with an HTTP API. It sends what the app
  asks it to (`POST /send`) and forwards every direct message to the app
  (`POST /api/whatsapp/incoming`), replying with whatever the app answers. Both sides
  authenticate with `BOT_TOKEN`, which the start script generates per start.

## Data model (`lib/db/schema.ts`)

| Table                     | Holds                                                                                                                                                                 |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `members`                 | people (kind `member`) and guests (kind `guest`, no login); phone in E.164, roles, PayPal.me, address, the restaurant they order from as host                         |
| `sessions`, `login_codes` | browser sessions and the six-digit WhatsApp codes (both hashed)                                                                                                       |
| `absences`                | date ranges someone is away                                                                                                                                           |
| `fridays`                 | one row per Friday that differs from the default: host, cancelled, mode (`delivery`/`flat`), restaurant or flat title and price, tip, drinks fee, lock and settlement |
| `attendance`              | explicit answers (`in`, `nofood`, `out`) and who added a guest                                                                                                        |
| `restaurants`, `dishes`   | fees (delivery, Lieferando's 0,99 € service fee) and menus; option groups are JSON on the dish; members can add dishes                                                |
| `order_items`             | what someone ordered, with name, options and price copied in                                                                                                          |
| `member_defaults`         | the default dish per member and restaurant; no dish means „nix“: silent means coming without eating                                                                   |
| `charges`                 | the final share per person after settlement                                                                                                                           |
| `payments`                | the money ledger: what someone paid for a Friday (negative = paid back)                                                                                               |
| `drinks_opt_outs`         | who switched the drinks fee off for a Friday                                                                                                                          |
| `notifications`           | keys of WhatsApp messages already sent, so each goes out once                                                                                                         |

A Friday without a row is a normal Friday: the default host and that host's restaurant.

## A Friday's life

1. **Open**: anyone answers and orders until 19:00 Berlin time (`lib/dates.ts`). Silent
   members count as in (`lib/attendance.ts`), or as coming without food when their default
   is „nix“; absences count as out. On a flat-price Friday only a yes counts.
   Without a picked restaurant the Friday uses its host's (`hostRestaurant`); the first
   order pins it, so handing the Friday to a substitute keeps the menu.
2. **Lock at 19:00** (`lockFriday`): the first page view or scheduler tick after the
   deadline locks the Friday once, writes host and restaurant down and adds each silent
   member's default dish.
3. **Order at 19:30**: the host copies the grouped order list into Lieferando.
4. **Settle**: the host enters what Lieferando charged; `splitTotal` (`lib/pricing.ts`)
   gives everyone their dishes plus an equal share of the rest (delivery, service fee, tip),
   cents distributed so the shares add up exactly. Flat-price Fridays skip this step.
5. **Pay**: balances come from the ledger (`lib/balance.ts`): food share plus the drinks fee
   minus payments. Positive means still to pay, negative means the host pays back. The host
   owes nothing.

## Money

- **Fees**: delivery, Lieferando's service fee and the tip (2,50 € unless the host sets
  another amount) are split equally among everyone who eats, before and after settlement.
  Until the lock the estimate already counts the defaults of silent members.
- **Drinks**: a flat 1,50 € per person who comes, eating or not, on by default and switched
  off per Friday by each member; the host can change or drop it for a Friday.
- **Paying**: a PayPal.me link with the amount filled in, to the host, as friends and family.
  Differences under 50 cents are shown but never chased.

## Permissions (`lib/permissions.ts`)

- Members change their own answer and order, and those of guests they brought, until 19:00.
- The Friday's host and admins run that Friday: restaurant or flat price, host, cancel,
  everyone's orders after the deadline, settlement and payments.
- Members with the „Gastgeber“ role (`assignsHosts`, given by an admin) may hand any single
  Friday to another host, in the calendar and on the Friday page, and nothing else of it.
- Admins and the host of the coming Friday add members and edit restaurants. Every member
  sets their own default dishes, the restaurant they order from as host, and their absences.

## Reminders (`lib/reminders.ts`)

`planReminders` turns a Friday and the current time into messages with keys; the scheduler
sends each key once. Every message has a window, so a container that was down does not send
stale reminders afterwards.

| When (Berlin)         | Who                                | What                                                       |
| --------------------- | ---------------------------------- | ---------------------------------------------------------- |
| Mon 18:00, Wed 10:00  | a host who is away that day        | find a substitute or cancel                                |
| Thu 18:00, Fri 12:00  | host, no restaurant yet            | pick one                                                   |
| Wed 12:00 – Fri 17:00 | members who haven't answered       | invitation with reply options (Thu 12:00 if no restaurant) |
| Fri 17:00             | in, nothing ordered                | order reminder naming their default                        |
| Fri 18:30             | in, nothing ordered, no default    | last call                                                  |
| Fri 18:30             | open balance ≥ 50 cents            | pay up front                                               |
| Fri 19:00             | host                               | the order list                                             |
| Sat–Mon 10:00         | host, not settled                  | enter what Lieferando charged                              |
| after settlement      | open balance ≥ 50 cents either way | amount to pay or to get back                               |
| daily 18:00, 10 days  | open balance ≥ 50 cents            | payment reminder                                           |
| cancelled Friday      | everyone                           | that it's off                                              |

## Pentecost

Every year the group spends Friday to Tuesday around Pentecost in Holland. `lib/pentecost.ts`
derives the dates from Easter; the header counts down to the Friday on every page, the
calendar shows the full countdown and marks that Friday.
