import Link from "next/link";
import { redirect } from "next/navigation";
import { FeedStreamProvider } from "../../components/feed-stream-provider";
import { NotificationToggle } from "../../components/notification-toggle";
import { ThemeToggle } from "../../components/theme-toggle";
import { getSessionToken } from "../../lib/session";

export default async function ProtectedLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  const token = await getSessionToken();
  if (!token) {
    redirect("/login");
  }

  return (
    <FeedStreamProvider>
      <main className="pageShell">
        <header className="topBar">
          <Link href="/feed" style={{ textDecoration: "none", color: "inherit" }}>
            <h1>Autoweb</h1>
          </Link>
          <span style={{ display: "flex", gap: "0.75rem", alignItems: "center" }}>
            <Link href="/feed" className="ghostButton">
              Feed
            </Link>
            <NotificationToggle />
            <ThemeToggle />
          </span>
        </header>
        {children}
      </main>
    </FeedStreamProvider>
  );
}
