import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { FeedStreamProvider } from "../../../components/feed-stream-provider";
import { ThemeToggle } from "../../../components/theme-toggle";
import { NotificationToggle } from "../../../components/notification-toggle";
import { getSessionToken } from "../../../lib/session";
import { readUiFeatures } from "../../../lib/ui-features";
import styles from "../../../components/refresh/refresh.module.css";

export const dynamic = "force-dynamic";

export default async function RefreshLayout({ children }: { children: React.ReactNode }) {
  if (!readUiFeatures(process.env).uiV2) notFound();
  if (!(await getSessionToken())) redirect("/login?next=/next");
  return (
    <FeedStreamProvider>
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link href="/next" className={styles.brand}>
            Autoweb
          </Link>
          <nav aria-label="Hovedmeny">
            <Link href="/next" aria-current="page">
              Feed
            </Link>
            <Link href="/feed">Klassisk</Link>
          </nav>
          <div className={styles.tools}>
            <NotificationToggle />
            <ThemeToggle />
          </div>
        </header>
        <main className={styles.main}>{children}</main>
      </div>
    </FeedStreamProvider>
  );
}
