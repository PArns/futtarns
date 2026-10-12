import { FridayScreen } from '@/components/friday/friday-screen';
import { getDb } from '@/lib/db';
import { getGroupContext } from '@/lib/session';

export default async function HomePage() {
  const { viewer, currentFriday } = await getGroupContext();
  return (
    <FridayScreen
      db={await getDb()}
      date={currentFriday}
      viewer={viewer}
      now={new Date()}
      isCurrent
    />
  );
}
