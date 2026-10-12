import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { FridayScreen } from '@/components/friday/friday-screen';
import { isFridayIso } from '@/lib/dates';
import { getDb } from '@/lib/db';
import { formatDay } from '@/lib/format';
import { getGroupContext } from '@/lib/session';

export async function generateMetadata(props: PageProps<'/freitag/[date]'>): Promise<Metadata> {
  const { date } = await props.params;
  return { title: isFridayIso(date) ? `Freitag, ${formatDay(date)}` : 'Freitag' };
}

export default async function FridayPage(props: PageProps<'/freitag/[date]'>) {
  const { date } = await props.params;
  if (!isFridayIso(date)) notFound();
  const { viewer, currentFriday } = await getGroupContext();
  if (date === currentFriday) redirect('/');
  return (
    <FridayScreen
      db={await getDb()}
      date={date}
      viewer={viewer}
      now={new Date()}
      isCurrent={false}
    />
  );
}
