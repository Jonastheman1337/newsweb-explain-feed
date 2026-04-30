import Link from "next/link";
import { NotificationToggle } from "../../components/notification-toggle";
import { ThemeToggle } from "../../components/theme-toggle";

export default function ProtectedLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <main className="pageShell">
      <header className="topBar">
        <Link href="/feed" style={{ textDecoration: "none", color: "inherit" }}>
          <h1>Autoweb</h1>
        </Link>
        <span style={{ display: "flex", gap: "0.25rem", alignItems: "center" }}>
          <NotificationToggle />
          <ThemeToggle />
        </span>
      </header>
      {children}
    </main>
  );
}
