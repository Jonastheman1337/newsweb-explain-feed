"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { loginWithPassword, verifyMagicLink } from "../../../lib/api";

type LoginFormProps = {
  token?: string;
};

export function LoginForm({ token }: LoginFormProps) {
  const router = useRouter();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<"idle" | "sending" | "sent" | "error" | "verifying">(
    token ? "verifying" : "idle"
  );
  const [message, setMessage] = useState("");

  const hasToken = useMemo(() => Boolean(token), [token]);

  useEffect(() => {
    async function verify(): Promise<void> {
      if (!token) return;
      try {
        await verifyMagicLink(token);
        router.replace("/feed");
      } catch (error) {
        setStatus("error");
        setMessage(
          error instanceof Error ? error.message : "Innloggingslenken er ugyldig eller utløpt."
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
      await loginWithPassword(username, password);
      router.replace("/feed");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Noe gikk galt.");
    }
  }

  return (
    <section className="loginCard">
      <h1>Autoweb</h1>
      <p>Logg inn med brukernavn og passord.</p>

      {hasToken ? (
        <p>{status === "verifying" ? "Verifiserer innlogging..." : message}</p>
      ) : (
        <form onSubmit={onSubmit} className="loginForm">
          <label htmlFor="username">Brukernavn</label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            required
          />
          <label htmlFor="password">Passord</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="current-password"
            required
          />
          <button type="submit" disabled={status === "sending"}>
            {status === "sending" ? "Logger inn..." : "Logg inn"}
          </button>
          {message ? <p>{message}</p> : null}
        </form>
      )}
    </section>
  );
}
