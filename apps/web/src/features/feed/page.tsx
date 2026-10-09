import { FeedProvider } from './FeedContext';
import { FeedShell } from './FeedShell';

export function Feed() {
  return (
    <FeedProvider>
      <FeedShell />
    </FeedProvider>
  );
}
