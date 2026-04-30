"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { requestMagicLink, verifyMagicLink } from "../../../lib/api";
import { SESSION_COOKIE } from "../../../lib/session-cookie";

type LoginFormProps = {
  token?: string;
};

export function LoginForm({ token }: LoginFormProps) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error" | "verifying">(
    token ? "verifying" : "idle"
  );
  const [message, setMessage] = useState("");

  const hasToken = useMemo(() => Boolean(token), [token]);

  useEffect(() => {
    async function verify(): Promise<void> {
      if (!token) return;
      try {
        const result = await verifyMagicLink(token);
        document.cookie = `${SESSION_COOKIE}=${encodeURIComponent(
          result.sessionToken
        )}; path=/; max-age=604800; samesite=lax`;
        router.replace("/feed");
      } catch (error) {
        setStatus("error");
        setMessage(
          error instanceof Error ? error.message : "Innloggingslenken er ugyldig eller utlopet."
        );
      }
    }
    void verify();
  }, [router, token]);

  async function onSubmit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setStatus("sending");
    setMessage("");
    try {
      const result = await requestMagicLink(email);
      if (result.bypassLogin?.sessionToken) {
        document.cookie = `${SESSION_COOKIE}=${encodeURIComponent(
          result.bypassLogin.sessionToken
        )}; path=/; max-age=604800; samesite=lax`;
        setMessage("Innlogget i lokal testmodus.");
        router.replace("/feed");
        return;
      }
      setStatus("sent");
      setMessage("Hvis e-posten er invitert, er lenken sendt.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Noe gikk galt.");
    }
  }

  return (
    <section className="loginCard">
      <h1>Autoweb</h1>
      <p>Invite-only tilgang. Logg inn med magic link.</p>

      {hasToken ? (
        <p>{status === "verifying" ? "Verifiserer innlogging..." : message}</p>
      ) : (
        <form onSubmit={onSubmit} className="loginForm">
          <label htmlFor="email">E-post</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="navn@firma.no"
            required
          />
          <button type="submit" disabled={status === "sending"}>
            {status === "sending" ? "Sender..." : "Send innloggingslenke"}
          </button>
          {message ? <p>{message}</p> : null}
        </form>
      )}
    </section>
  );
}
