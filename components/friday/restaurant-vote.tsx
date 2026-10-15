'use client';

import { BookOpen, ChevronDown, Crown, ExternalLink, Vote as VoteIcon } from 'lucide-react';
import { useState } from 'react';
import { menuPreviewAction, voteAction } from '@/app/actions';
import {
  DishDialog,
  type MenuDish,
  type OpenedDish,
  type OrderTarget,
} from '@/components/friday/dish-dialog';
import { MenuPreview } from '@/components/friday/menu-preview';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { GlassCard } from '@/components/ui/glass-card';
import { Pill } from '@/components/ui/pill';
import { formatCountdown } from '@/lib/format';
import { useAction } from '@/lib/hooks/use-action';
import { useNow } from '@/lib/hooks/use-now';
import { cn } from '@/lib/utils';
import { deliveryTerms, type VoteOption } from '@/lib/vote';

export type BallotOption = VoteOption & {
  letter: string;
  /** What the Friday orders from if the vote changes nothing. */
  current: boolean;
  voters: { id: number; name: string }[];
  /** What the viewer ordered ahead from it, such as `2× Maki Lachs`. */
  preordered: string[];
};

/**
 * The restaurant vote: every option with who wants it, and the viewer's own pick, which
 * they can change or take back until Thursday midnight. The most votes win; without votes
 * or on a tie it stays as it is. A dish tapped in a menu is ordered (ahead, unless the
 * Friday orders there already) and votes for its restaurant.
 */
export function RestaurantVote({
  date,
  options,
  myVote,
  orderAs,
  canVote = true,
  closesAt,
  serverNow,
}: {
  date: string;
  options: BallotOption[];
  myVote: number | null;
  /** The viewer, while they can still order; otherwise the menus are only to look at. */
  orderAs: OrderTarget | null;
  /** False for a guest who has not said yes yet: they can look, not vote. */
  canVote?: boolean;
  closesAt: number;
  serverNow: number;
}) {
  const now = useNow(serverNow);
  const { pending, execute } = useAction();
  const most = Math.max(0, ...options.map((option) => option.voters.length));
  const open = now < closesAt;
  // One menu open at a time, each fetched the first time it is opened.
  const [shownMenu, setShownMenu] = useState<number | null>(null);
  const [menus, setMenus] = useState<Record<number, MenuDish[] | 'failed'>>({});
  const [opened, setOpened] = useState<OpenedDish | null>(null);
  const [openCount, setOpenCount] = useState(0);
  const [orderFrom, setOrderFrom] = useState<BallotOption | null>(null);
  // Ordering ahead goes with the vote, so ordering anywhere else drops it.
  const aheadAt = options.find((option) => option.preordered.length > 0 && !option.current);

  function pick(option: BallotOption, dish: MenuDish) {
    setOrderFrom(option);
    setOpenCount(openCount + 1);
    setOpened({ dish, instance: openCount + 1 });
  }

  function hintFor(option: BallotOption): string {
    const voted = options.find((entry) => entry.id === myVote);
    // A dish from the current restaurant is the fallback and leaves a vote elsewhere alone.
    if (option.current) {
      return !voted
        ? `Damit wählst du auch ${option.name}.`
        : voted.id === option.id
          ? ''
          : `Deine Stimme bleibt bei ${voted.name}. Das hier bekommst du, falls es bei ${option.name} bleibt.`;
    }
    const lines = [
      option.id === myVote
        ? `Die Bestellung zählt, wenn ${option.name} die Wahl gewinnt.`
        : `Damit wählst du ${option.name}. Die Bestellung zählt, wenn es gewinnt.`,
      aheadAt && aheadAt.id !== option.id
        ? `Deine Vorbestellung bei ${aheadAt.name} fliegt dann raus.`
        : '',
    ];
    return lines.filter(Boolean).join(' ');
  }

  async function toggleMenu(restaurantId: number) {
    if (shownMenu === restaurantId) return setShownMenu(null);
    setShownMenu(restaurantId);
    if (menus[restaurantId] && menus[restaurantId] !== 'failed') return;
    const dishes = await menuPreviewAction(restaurantId).catch(() => 'failed' as const);
    setMenus((loaded) => ({ ...loaded, [restaurantId]: dishes }));
  }

  return (
    <GlassCard variant="tile" className="space-y-3 p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-muted-foreground text-sm">
          {canVote
            ? 'Antworten geht auch per WhatsApp mit dem Buchstaben.'
            : 'Sag oben zu, dann stimmst du mit ab.'}
          {orderAs &&
            ' Tippst du in einer Karte auf ein Gericht, bestellst du es. Bei einem anderen als dem bisherigen Restaurant ist das zugleich deine Stimme.'}
        </p>
        <Pill tone={open ? 'primary' : 'muted'}>
          {open ? `Wahllokal schließt ${formatCountdown(closesAt - now)}` : 'Wahllokal geschlossen'}
        </Pill>
      </div>
      <ul className="divide-border/50 divide-y">
        {options.map((option) => {
          const mine = option.id === myVote;
          const leading = most > 0 && option.voters.length === most;
          return (
            <li key={option.id} className="py-3">
              <div className="flex items-center gap-3">
                <span
                  className={cn(
                    'flex size-8 shrink-0 items-center justify-center rounded-full border text-sm font-extrabold',
                    mine ? 'border-primary bg-primary/15 text-primary' : 'border-border'
                  )}
                >
                  {option.letter}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    <span className="font-semibold">{option.name}</span>
                    {option.current && (
                      <span className="text-warning inline-flex items-center gap-1 text-xs font-semibold">
                        <Crown className="size-3.5" /> bisher
                      </span>
                    )}
                  </div>

                  <div className="text-muted-foreground mt-0.5 flex flex-wrap items-center gap-1.5 text-xs">
                    {option.cuisine && <span>{option.cuisine}</span>}
                    {option.voters.length > 0 && (
                      <span
                        className={cn(
                          'inline-flex flex-wrap items-center gap-1',
                          leading && 'text-foreground font-semibold'
                        )}
                      >
                        {option.cuisine && <span aria-hidden>·</span>}
                        {option.voters.length} {option.voters.length === 1 ? 'Stimme' : 'Stimmen'}:
                        <span className="flex -space-x-1.5">
                          {option.voters.slice(0, 5).map((voter) => (
                            <Avatar
                              key={voter.id}
                              name={voter.name}
                              id={voter.id}
                              className="ring-background size-5 text-[9px] ring-2"
                            />
                          ))}
                        </span>
                        {option.voters.map((voter) => voter.name).join(', ')}
                      </span>
                    )}
                  </div>
                  <div className="text-muted-foreground mt-0.5 text-xs">
                    {deliveryTerms(option)}
                  </div>
                  {option.preordered.length > 0 && (
                    <div className="mt-0.5 text-xs">
                      <span className="text-primary font-semibold">
                        Vorbestellt: {option.preordered.join(', ')}
                      </span>
                      <span className="text-muted-foreground">
                        {' '}
                        · fliegt raus, wenn du umwählst
                      </span>
                    </div>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs font-semibold">
                    {option.dishCount > 0 ? (
                      <button
                        type="button"
                        onClick={() => toggleMenu(option.id)}
                        aria-expanded={shownMenu === option.id}
                        aria-controls={`karte-${option.id}`}
                        className="text-primary inline-flex items-center gap-1 whitespace-nowrap hover:underline"
                      >
                        <BookOpen className="size-3.5" />
                        <span>
                          Karte ({option.dishCount}{' '}
                          {option.dishCount === 1 ? 'Gericht' : 'Gerichte'})
                        </span>
                        <ChevronDown
                          className={cn(
                            'size-3.5 transition-transform',
                            shownMenu === option.id && 'rotate-180'
                          )}
                        />
                      </button>
                    ) : (
                      <span className="text-muted-foreground font-normal">
                        Noch keine Karte hier
                      </span>
                    )}
                    {option.lieferandoUrl && (
                      <a
                        href={option.lieferandoUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 whitespace-nowrap"
                        aria-label={`${option.name} bei Lieferando ansehen`}
                      >
                        <ExternalLink className="size-3.5" /> Lieferando
                      </a>
                    )}
                  </div>
                </div>
                <Button
                  variant={mine ? 'default' : 'outline'}
                  size="sm"
                  disabled={pending || !open || !canVote}
                  onClick={() => execute(() => voteAction(date, mine ? null : option.id))}
                  aria-pressed={mine}
                >
                  <VoteIcon className="max-sm:hidden" /> {mine ? 'Meine Wahl' : 'Wählen'}
                </Button>
              </div>
              {/* Stays mounted once opened, so closing slides it shut like the opening did. */}
              {(shownMenu === option.id || menus[option.id]) && (
                <div
                  id={`karte-${option.id}`}
                  inert={shownMenu !== option.id}
                  className={cn(
                    'grid transition-[grid-template-rows,opacity] duration-300 ease-out motion-reduce:transition-none',
                    shownMenu === option.id
                      ? 'grid-rows-[1fr] opacity-100 starting:grid-rows-[0fr] starting:opacity-0'
                      : 'grid-rows-[0fr] opacity-0'
                  )}
                >
                  <div className="overflow-hidden">
                    <div className="border-border/60 bg-background/40 mt-3 rounded-xl border p-3 sm:ml-11">
                      {menus[option.id] === 'failed' ? (
                        <p className="text-error text-sm">
                          Die Karte ließ sich nicht laden. Versuch es gleich noch mal.
                        </p>
                      ) : menus[option.id] ? (
                        <MenuPreview
                          dishes={menus[option.id] as MenuDish[]}
                          onPick={orderAs && open ? (dish) => pick(option, dish) : undefined}
                        />
                      ) : (
                        <p className="text-muted-foreground text-sm">Karte wird geladen …</p>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {orderAs && orderFrom && (
        <DishDialog
          opened={opened}
          onClose={() => setOpened(null)}
          mode="order"
          date={date}
          restaurantId={orderFrom.id}
          targets={[orderAs]}
          initialTargetId={orderAs.id}
          ahead={!orderFrom.current}
          vote
          hint={hintFor(orderFrom)}
        />
      )}
    </GlassCard>
  );
}
