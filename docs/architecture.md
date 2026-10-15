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

| Table                     | Holds                                                                                                                                                                                                           |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `members`                 | people (kind `member`) and guests (kind `guest`, no login); phone in E.164, roles, the Stammtruppe flag (`core`), PayPal.me, address, the restaurant they order from as host                                    |
| `sessions`, `login_codes` | browser sessions and the six-digit WhatsApp codes (both hashed)                                                                                                                                                 |
| `absences`                | date ranges someone is away                                                                                                                                                                                     |
| `fridays`                 | one row per Friday that differs from the default: host, cancelled, mode (`delivery`/`flat`), restaurant or flat title and price, tip, drinks fee, voucher, pickup and who fetches the food, lock and settlement |
| `restaurant_votes`        | who wants which restaurant for a Friday, one vote per member                                                                                                                                                    |
| `restaurant_hosts`        | which hosts a restaurant delivers to; none means everyone                                                                                                                                                       |
| `attendance`              | explicit answers (`in`, `nofood`, `out`) and who added a guest                                                                                                                                                  |
| `restaurants`, `dishes`   | fees (delivery, Lieferando's 0,99 € service fee), whether pickup is possible, and menus; option groups are JSON on the dish; members can add dishes                                                             |
| `order_items`             | what someone ordered and where from, with name, category, options and price copied in; only the Friday's restaurant counts                                                                                      |
| `member_defaults`         | the default dish per member and restaurant; no dish means „nix“: silent means coming without eating                                                                                                             |
| `charges`                 | the final share per person after settlement                                                                                                                                                                     |
| `payments`                | the money ledger: what someone paid for a Friday and to whom (negative = paid back; no payee = the host)                                                                                                        |
| `drinks_opt_outs`         | who switched the drinks fee off for a Friday                                                                                                                                                                    |
| `notifications`           | keys of WhatsApp messages already sent, so each goes out once                                                                                                                                                   |
| `app_secrets`             | keys the app makes for itself on first use, such as the one that signs payment links                                                                                                                            |

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
   owes nothing, unless someone else fetched the food (see Pickup).

## Money

- **Fees**: delivery, Lieferando's service fee and the tip (2,50 € unless the host sets
  another amount) are split equally among everyone who eats, before and after settlement.
  Until the lock the estimate already counts the defaults of silent members.
- **Voucher**: the host can enter a Lieferando voucher for a Friday's order. It comes off the
  shared part of the bill, so everyone who eats gets an equal share of it, shown as its own
  line („Anteil Gutschein“); the order list reminds the host to redeem it.
- **Drinks**: a flat 1,50 € per person who comes, eating or not, on by default and switched
  off per Friday by each member; the host can change or drop it for a Friday.
- **Paying**: a PayPal.me link with the amount filled in, to the host, as friends and family.
  Differences under 50 cents are shown but never chased.
- **Pickup**: a restaurant can offer pickup („Abholen geht auch“), and the host then chooses
  per Friday between delivery and pickup and who fetches the food. Fetched food costs the
  menu prices: no delivery or service fee, no tip, no minimum order (`estimateFees`), a
  voucher still comes off. Whoever fetches it pays the restaurant and gets the food money;
  the drinks money still goes to the host. So a balance is split into debts per payee
  (`moneyFor`, `Money.debts`): one debt to the host as before, or with a picker one for the
  food to them and one for the drinks to the host. Payments record their payee, the pay
  box and the WhatsApp messages show a PayPal link per payee, and „Hab bezahlt“, the pay
  link and the bot's „bezahlt“ book every open debt at once. The order list goes to the
  picker. The amounts are final at the deadline (`isBilled`), so there is no settle reminder
  and the payment reminders start the next evening; the host can still enter a different
  total. Once anyone has paid, pickup and picker stay as they are (`setPickup`).

## Stammtruppe and guests

Members carry a `core` flag, the Stammtruppe. Only they are asked every week, count as in
when they say nothing, host and vote every Friday. Everyone else with a login is a guest:
they stay in the members table, log in with their number, and take part in a Friday once
they say yes themselves (the Friday page shows them the answer buttons, the bot takes a
`1`) or someone adds them (an attendance row). On every other Friday they count as out and
appear nowhere (`effectiveAttendance`, the people queries in `loadFriday` and
`loadCalendar`), and nobody messages them about it.

A guest added with a phone number (`addGuestWithPhone`) gets such an account and an
invitation by WhatsApp with a login link; the same number brings back the same member,
and known guests can be invited again with one tap (`inviteMember`), with a short
WhatsApp note. A guest without a number stays a name on one Friday, whose bringer orders
and pays for them; giving them a login keeps them outside the Stammtruppe. Admins switch
the flag on the people page, and new members get it by default.

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

| When (Berlin)        | Who                                        | What                                                  |
| -------------------- | ------------------------------------------ | ----------------------------------------------------- |
| Mon 18:00, Wed 10:00 | a host who is away that day                | find a substitute or cancel                           |
| Wed 12:00 – Thu      | members who haven't answered               | whether they come, with reply options, and the vote   |
| Wed 12:00 – Thu      | everyone else coming who hasn't voted      | the restaurant vote, if one is running                |
| Thu 18:00            | coming, got the ballot, not voted          | the standings, while their votes could still swing    |
| Thu 18:00, Fri 09:00 | host, no restaurant yet                    | pick one (not Thursday while the group votes)         |
| Fri 08:00            | whom the vote left without an order        | the winner, and to pick (and answer, if they haven't) |
| Fri 10:00 – 17:00    | members who haven't answered               | invitation with reply options and what to order       |
| Fri 10:00            | said yes before, uninvited, no order       | order reminder naming their default                   |
| Fri 18:30            | in before then, nothing ordered or default | last call                                             |
| Fri 19:00            | host                                       | the order list                                        |
| Fri 19:00            | open balance ≥ 50 cents                    | what to pay, with the PayPal link: paying opens here  |
| Sat–Mon 10:00        | host, not settled                          | enter what Lieferando charged                         |
| after settlement     | open balance ≥ 50 cents either way         | amount to pay or to get back                          |
| daily 18:00, 10 days | open balance ≥ 50 cents                    | payment reminder                                      |
| cancelled Friday     | everyone                                   | that it's off                                         |

Each message goes out once per person and reason, and never right after something that
already said the same: the Wednesday question carries the ballot, so answering it does not
bring the ballot again; whoever says yes after the 10:00 order reminder or the 18:30 last
call (`answeredAt`) was just told by the bot's reply or the page, so those reminders only go
to whoever answered before them.

Paying opens at the deadline (`paymentOpen`): before it, orders and with them the shares still
change. Until then the page shows the running amount without a pay button, and neither the
page, the bot nor a pay link books a payment. Messages use WhatsApp's `*bold*` (`lib/messages.ts`)
for the facts that matter, and the login code stands bold on a line of its own.

Every payment message carries a „bezahlt“ link (`lib/pay-links.ts`): a signed token for one
Friday and one person, so it needs no login. Opening it only shows what is open; the button
on the page books it, because chat apps open links for their previews. Once nothing is open,
the reminders stop by themselves. Replying „bezahlt“ to the bot still works too.

The host and admins see what is still to go out, to whom and when, with a countdown, in the
Friday's „Chefsache“ (`previewReminders`, `upcomingMessages`). It runs `planReminders` at
every moment a window opens, with the Friday locked from the deadline on, plus the
scheduler's next pass for what is due right away, and leaves out keys already sent. Settle
and payment reminders repeat daily, so it shows the next one of each. It is a forecast:
whoever answers or orders in the meantime drops out of later reminders.

Besides answers, the bot understands „wie immer“ (orders the default dish now, or comes
without food for a „nix“ default) and „andere“ (who eats what this Friday).

## Restaurant vote (`lib/vote.ts`)

Unless the host picks the restaurant themselves (`restaurantChosen`), the group votes on it
until Thursday 23:59. The ballot lists the restaurants that can serve this Friday's host
(`restaurantsForHost`): those that deliver to the host's address (`restaurant_hosts`, ticked
under „Liefert zu“ on the restaurant; none ticked means everyone) and those that offer
pickup, marked „nur abholen“. They are lettered in the order they were created, so a
letter stays put while new restaurants join. Members vote on the Friday page or by
replying with the letter to the Wednesday message, which carries every Lieferando link;
they can change or take back their vote until the end. The page and the bot's reply show
who voted for what, and each restaurant's menu folds open on the page, fetched when first
opened (`menuPreviewAction`).

At midnight (`closeVote`, from the timer or the first page view) the restaurant with the
most votes wins. Without votes, or when two share the lead, the current restaurant (the
host's usual one, or whatever the first order pinned) stays. A winner that does not deliver
to the host makes the Friday a pickup Friday.

While the vote runs, the Friday page says so at the top (`VoteBanner`: countdown and who
leads), and so do the calendar and the bot's „status“. Ordering already works: from the
current restaurant as usual, and ahead from the restaurant a member votes for (`addItem`
with `from`). Each item carries its restaurant; only the Friday's counts, the rest stays out
of the participants, prices and order list (`preorders`) and shows grouped under its
restaurant on the page, in the cards and in the bot's „andere“. Tapping a dish in a
ballot's menu orders it: from another restaurant it orders ahead and casts the vote; from
the current one it is the fallback and votes only for whoever has not voted yet, so
someone can have both the dish they want and one in case their pick loses. The menu
chapter then offers the current restaurant and the voted one side by side, and the money
box shows both outcomes: the amount if it stays, and roughly what it comes to if the
voted one wins (`ahead`). Changing or taking back the vote drops what was ordered ahead
(`castVote`).

At midnight the winner's orders stay and all others go. Whom that leaves without an order
from the winner (`voteDroppedIds`: their orders went, their pick lost, or they said yes to
the restaurant it replaced) gets a message at 08:00 on Friday, never at night; whoever has
not answered yet is asked there too, instead of the 10:00 invitation. Thursday at 18:00,
whoever is coming, got the ballot and has not voted gets a reminder with the standings, but
only while the missing votes could still change the result (`couldSwing`). A host's pick
ends the vote like the count does, without the messages, and the lock clears whatever is
left.

## Pentecost

Every year the group spends Friday to Tuesday around Pentecost in Holland. `lib/pentecost.ts`
derives the dates from Easter; the header counts down to the Friday on every page, the
calendar shows the full countdown and marks that Friday.
