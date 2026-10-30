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
| `attendance`              | explicit answers (`in`, `nofood`, `out`), who added a guest, and „Ich komm später“ (`late`, `arrives_at` like `21:00`)                                                                                          |
| `restaurants`, `dishes`   | fees (delivery, Lieferando's 0,99 € service fee, tip), whether pickup is possible, and menus; option groups are JSON on the dish; members can add dishes                                                        |
| `order_items`             | what someone ordered and where from, with name, category, options and price copied in; only the Friday's restaurant counts                                                                                      |
| `member_defaults`         | the default dish per member and restaurant; no dish means „nix“: silent means coming without eating                                                                                                             |
| `charges`                 | the final share per person after settlement                                                                                                                                                                     |
| `payments`                | the money ledger: what someone paid for a Friday and to whom (negative = paid back; no payee = the host)                                                                                                        |
| `drinks_opt_outs`         | who switched the drinks fee off for a Friday                                                                                                                                                                    |
| `notifications`           | keys of WhatsApp messages already sent, so each goes out once                                                                                                                                                   |
| `app_secrets`             | keys the app makes for itself on first use, such as the one that signs payment links                                                                                                                            |

A Friday without a row is a normal Friday: the default host and that host's restaurant.
An admin can put a Friday at nobody's place (`no_host`, „Bei niemandem“, `clearHost`): then
it has no host, not even the default one, and the Stammtruppe sorts out among themselves who
takes it over (see Permissions).

## A Friday's life

1. **Open**: anyone answers and orders until 19:30 Berlin time (`lib/dates.ts`). Silent
   members count as in (`lib/attendance.ts`), or as coming without food when their default
   is „nix“; absences count as out. On a flat-price Friday only a yes counts, except for its host,
   who is there anyway.
   Without a picked restaurant the Friday uses its host's (`hostRestaurant`); the first
   order pins it, so handing the Friday to a substitute keeps the menu.
2. **Lock at 19:30** (`lockFriday`): the first page view or scheduler tick after the
   deadline locks the Friday once, writes host and restaurant down and adds each silent
   member's default dish.
3. **Order at 19:45**: the host copies the grouped order list into Lieferando.
4. **Settle**: the host enters what Lieferando charged; `splitTotal` (`lib/pricing.ts`)
   gives everyone their dishes plus an equal share of the rest (delivery, service fee, tip),
   cents distributed so the shares add up exactly. Flat-price Fridays skip this step.
5. **Pay**: balances come from the ledger (`lib/balance.ts`): food share plus the drinks fee
   minus payments. Positive means still to pay, negative means the host pays back. The host
   owes nothing, unless someone else fetched the food (see Pickup).

## Money

- **Fees**: delivery, Lieferando's service fee and the tip (each restaurant's own, 2,50 €
  unless set otherwise on the restaurant, and the host can set another amount for a Friday)
  are split equally among everyone who eats, before and after settlement.
  Until the lock the estimate already counts the defaults of silent members.
- **Voucher**: the host can enter a Lieferando voucher for a Friday's order. It comes off the
  shared part of the bill, so everyone who eats gets an equal share of it, shown as its own
  line („Anteil Gutschein“); the order list reminds the host to redeem it.
- **Drinks**: a flat 1,50 € per person who comes, eating or not, on by default and switched
  off per Friday by each member; the host can change or drop it for a Friday.
- **Paying**: a PayPal.me link with the amount (`paypal.me/name/12.34EUR`, as PayPal documents
  it), to the host, as friends and family. The website fills the amount in; the PayPal app,
  which opens these links on a phone, does not always, so messages name the amount next to the
  link and the page offers it to copy (`paypalAmount`).
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
they say yes themselves (the Friday page shows them the answer buttons, and while they
decide the ballot and the menu to look at, but not the others' money; the bot takes a
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

- Members change their own answer and order, and those of guests they brought, until 19:30.
- The Friday's host and admins run that Friday: restaurant or flat price, host, cancel,
  everyone's orders after the deadline, settlement and payments.
- Members with the „Vertretungen“ role (`assignsHosts`, given by an admin) may hand any single
  Friday to another host, in the calendar and on the Friday page, and nothing else of it.
- When a Friday's host is away that day, or it has none, anyone of the Stammtruppe who is
  around may take it over themselves („Ich übernehme“ on the page and in the calendar, or
  „übernehme“ to the bot; `canTakeOver`, `takeOverFriday`) until the deadline.
- Only admins put a Friday at nobody's place (`canClearHost`), in the host pickers.
- Admins and the host of the coming Friday add members and edit restaurants. Every member
  sets their own default dishes, the restaurant they order from as host, and their absences.

## Reminders (`lib/reminders.ts`)

`planReminders` turns a Friday and the current time into messages with keys; the scheduler
sends each key once. Every message has a window, so a container that was down does not send
stale reminders afterwards. Nothing goes out before ten in the morning (`QUIET_UNTIL_HOUR`):
whatever falls due at night, such as a cancellation or a settlement, waits until ten.

| When (Berlin)         | Who                                        | What                                                                                                                              |
| --------------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| Mon 18:00, Wed 10:00  | a host who is away that day                | find a substitute or cancel                                                                                                       |
| Mon 18:00             | the Stammtruppe around, on a hostless day  | nobody hosts, sort it out: „übernehme“ or the page; the group chat too                                                            |
| Wed 12:00 – Thu       | members who haven't answered               | whether they come, with reply options, and the vote                                                                               |
| Wed 12:00 – Fri 16:00 | everyone else coming who hasn't voted      | the restaurant vote, if one is running                                                                                            |
| Thu 18:00             | coming, got the ballot, not voted          | the standings, while their votes could still swing                                                                                |
| Thu 18:00, Fri 10:00  | host, no restaurant yet                    | pick one; after a vote only once it is over, at 16:00                                                                             |
| Fri 10:00 – 17:00     | members who haven't answered               | invitation with reply options and what to order, or the ballot while the vote runs                                                |
| Fri 10:00             | said yes before, uninvited, no order       | order reminder naming their default; at 16:00 after a vote                                                                        |
| Fri 16:00             | whom the vote left without an order        | the winner, and to pick (and answer, if they haven't)                                                                             |
| Fri 16:00             | invited while the vote ran, no order       | the winner, and to pick                                                                                                           |
| Fri 19:00             | in before then, nothing ordered or default | last call, with last time's order here („gleiches“)                                                                               |
| Fri 19:30             | host                                       | the order list, the latecomers' dishes apart                                                                                      |
| on release            | open balance ≥ 50 cents                    | what to pay, with the PayPal link, if the host releases with messages; without a release by Sat 10:00 it goes out then on its own |
| Sat 10:00             | host, not settled                          | enter what Lieferando charged, if it differs from the estimate (which stands otherwise)                                           |
| settling or resending | whose total changed since their link       | the corrected amount to pay or to get back; nobody else hears anything                                                            |
| daily 18:00, 10 days  | open balance ≥ 50 cents                    | payment reminder                                                                                                                  |
| cancelled Friday      | everyone                                   | that it's off                                                                                                                     |

Each message goes out once per person and reason, and never right after something that
already said the same: the Wednesday question carries the ballot, and so does the Friday
invitation while the vote runs, so answering either does not bring the ballot again;
whoever says yes after the order reminder or the 19:00 last call (`answeredAt`) was just
told by the bot's reply or the page, so those reminders only go to whoever answered before
them.

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
scheduler's next pass for what is due right away, and leaves out keys already sent (keys carry
the Friday's date in the middle, or at the end like the order list's `sheet:<date>`). Settle
and payment reminders repeat daily, so it shows the next one of each. It is a forecast:
whoever answers or orders in the meantime drops out of later reminders. When the bot is not
linked to WhatsApp, the list says so: what is due waits and is retried every minute.

Besides answers, the bot understands „wie immer“ (orders the default dish now, or comes
without food for a „nix“ default), „gleiches“ (orders again what they had the last time at
this restaurant, `orderSame`; dishes gone from the menu are named and left out), „später“
(„Ich komm später“, optionally with a time: `später 21:30`; „pünktlich“ takes it back) and
„andere“ (who eats what this Friday). An answer and a ballot letter fit into one reply, in
either order and with or without a space (`1E`, `E 1`, `2B`): the answer counts first, then
the vote; without a vote running, the answer still does.

### Claude in the bot (`lib/assistant.ts`, `lib/services/assistant.ts`)

With a Claude API key (set by an admin on the people page, or `ANTHROPIC_API_KEY`), a member's
message that no command matches goes to Claude (`claude-haiku-5-5`, `ASSISTANT_MODEL`). Messages
from unknown numbers are not read at all. Claude gets the facts of this Friday as the member
may see them on the page (`assistantFacts`: phases, the vote, who ordered what, their own
answer, order lines, money, earlier orders and defaults, the menus at hand, their role) and
read-only research tools for the rest (`assistantResearch`: restaurants, menus, their order
history, other and coming Fridays, what the group likes somewhere, their balances). Every tool
answers for the member who wrote, whatever Claude passes in, and none returns phone numbers,
addresses, keys, links or anyone else's money.

Claude answers with one action from a fixed list (`Interpretation`), and the bot runs it like
the member's own command (`understand`, then `runCommand`), with the page's rules: answering,
voting (also by the restaurant's name), ordering a dish (checked against the menu; another
restaurant than the Friday's only from the ballot while the vote runs), replacing or removing
their own order lines, defaults, the drinks fee, absences, coming later, taking a Friday over;
the host and admins can also settle the restaurant („sicher“ when that ends the vote or
throws orders away) and have the bot remind people („erinner Guido“, „erinner alle, die noch
nichts bestellt haben“): the bot writes each a reminder that names who asked, according to
what they still have to do (`nudgeText`), sends them one by one after its answer, at most one
per person and hour, never to whoever is away or said no, and only until the deadline. It never books a payment, only asks for
„bezahlt“, and answers never come confirmed, so throwing an order away still needs „sicher“.
Everything else is a short reply Claude writes itself: explaining where the Friday stands,
advice from the member's history and the others' picks, banter; work outside the Friday
(code, homework, other services) and attempts to change its rules get a cheeky no. A reply
with code in it never goes out. Each member gets 25 readings a day (`DailyLimit`), and the
questions and invitations say people can just write (`CHAT_HINT`).

„Ich komm später“ (`setLate`) is a yes for whoever had not answered or was out, works after
the deadline too (`canSetArrival`), and goes when someone backs out. The dish is still
picked by the deadline; the order list on the page and in the 19:30 message shows the
latecomers' dishes in a block of their own („Später bestellen“, `sheetsByArrival`), so the
host can order them later and they arrive warm. The people list says „kommt später (~21:00)“.

Ordering the same dish with the same options and note again raises its line's quantity
instead of adding a line, and the same dish again within ten seconds counts once: that is a
double tap (`addItem`). On the page, the menu marks what the viewer already ordered („✓
bestellt“), the dish dialog says so before a second one, and an order plays a short
animation where it lands: the dish card, the order bar on a phone, the order column on a
desktop (`announceOrder`, `useOrderFlash`).

## Restaurant vote (`lib/vote.ts`)

Unless the host picks the restaurant themselves (`restaurantChosen`), the group votes on it
until Friday 16:00 (`VOTE_CLOSE_HOUR`), three and a half hours before the order deadline. The ballot lists the restaurants that can serve this Friday's host
(`restaurantsForHost`): those that deliver to the host's address (`restaurant_hosts`, ticked
under „Liefert zu“ on the restaurant; none ticked means everyone) and those that offer
pickup, marked „nur abholen“. They are lettered in the order they were created, so a
letter stays put while new restaurants join. Members vote on the Friday page or by
replying with the letter to the Wednesday message, which asks who comes first and then
lists the restaurants by letter, with one link to the page for menus and delivery terms;
they can change or take back their vote until the end. The page and the bot's reply show
who voted for what, and each restaurant's menu folds open on the page, fetched when first
opened (`menuPreviewAction`).

At 16:00 (`closeVote`, from the timer or the first page view) the restaurant with the
most votes wins. Without votes, or when two share the lead, the current restaurant (the
host's usual one, or whatever the first order pinned) stays. A winner that does not deliver
to the host makes the Friday a pickup Friday.

A vote is a yes, like an order: whoever had not answered or was out is in once they vote,
and gets their default at the winner unless they pick something else; coming without food
stays (`castVote`). The money box then also shows the voted restaurant with that default,
when nothing was ordered ahead there.

While the vote runs, the Friday page names no restaurant at the top („Wo essen wir?“), and
its phase bar (`PhaseBar`: Wahl, Bestellen, Essen, Zahlen, the current one lit, with a
countdown and who leads) says it is not settled until 16:00; so do the calendar and the
bot's „status“. When the clock moves the page into the next phase, it asks the server again,
which counts the vote or locks the orders. Ordering already works: from the
current restaurant as usual, and ahead from the restaurant a member votes for (`addItem`
with `from`). Each item carries its restaurant; only the Friday's counts, the rest stays out
of the participants, prices and order list (`preorders`) and shows grouped under its
restaurant on the page, in the cards and in the bot's „andere“. Tapping a dish in a
ballot's menu orders it: from another restaurant it orders ahead and casts the vote; from
the current one it is the fallback and votes only for whoever has not voted yet, so
someone can have both the dish they want and one in case their pick loses. The menu
chapter then offers the current restaurant and the voted one side by side, and the money
box shows both outcomes: the amount if it stays, and roughly what it comes to if the
voted one wins (`ahead`). Both are priced by the same rule (`withDefaults`): what was ordered
from that restaurant plus the default there of everyone who comes and has nothing there, so
each splits its fees among the people who would really eat if it were the one. Changing or
taking back the vote drops what was ordered ahead (`castVote`).

At 16:00 the winner's orders stay and all others go. Whom that leaves without an order
from the winner (`voteDroppedIds`: their orders went, their pick lost, or they said yes to
the restaurant it replaced) gets a message right then, in place of the order reminder or
the restaurant's announcement due with it; whoever has not answered yet is asked there.
Until then nobody is told to pick from a restaurant that may still change: the Friday
invitation carries the ballot instead of the restaurant (`invite-open`), and the order
reminder and the restaurant's announcement wait for the result. Thursday at 18:00, whoever is coming, got the ballot and has not voted gets a reminder with
the standings, but only while the missing votes could still change the result
(`couldSwing`). A host's pick ends the vote like the count does, without the messages, and
the lock clears whatever is left.

## Pentecost

Every year the group spends Friday to Tuesday around Pentecost in Holland. `lib/pentecost.ts`
derives the dates from Easter; the header counts down to the Friday on every page, the
calendar shows the full countdown and marks that Friday.

## On a phone

Most people open the page on an iPhone, so it never scrolls sideways. `html` and `body`
clip whatever sticks out (`overflow-x: clip`, which unlike `hidden` keeps sticky elements
working), and narrow screens drop text instead of overflowing: the header shows icons and
only the flag of the Holland countdown, a Friday's kicker only the date, the steps only the
next label. Form fields are 16px on a phone, because iOS Safari zooms into a smaller field
on focus and the page then pans sideways. The small pill select (`Select variant="sm"`)
shows its choice in small text, with the real select invisible on top at 16px.
