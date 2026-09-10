import Link from "next/link";
import { redirect } from "next/navigation";
import { FeedStreamProvider } from "../../components/feed-stream-provider";
import { ThemeToggle } from "../../components/theme-toggle";
import { NotificationToggle } from "../../components/notification-toggle";
import { FeedConnection } from "../../components/refresh/feed-connection";
import { getSessionToken } from "../../lib/session";
import styles from "../../components/refresh/refresh.module.css";

export const dynamic = "force-dynamic";

export default async function RefreshLayout({ children }: { children: React.ReactNode }) {
  if (!(await getSessionToken())) redirect("/login");
  return (
    <FeedStreamProvider view="v2">
      <div className={styles.shell}>
        <header className={styles.header}>
          <Link href="/" className={styles.brand}>
            Autoweb
          </Link>
          <nav aria-label="Hovedmeny">
            <Link href="/" aria-current="page">
              Feed
            </Link>
            <Link href="/legacy">Klassisk</Link>
          </nav>
          <div className={styles.tools}>
            <FeedConnection fixtures={process.env.UI_PREVIEW_FIXTURES === "true"} />
            <NotificationToggle />
            <ThemeToggle />
          </div>
        </header>
        <main className={styles.main}>{children}</main>
      </div>
    </FeedStreamProvider>
  );
}
