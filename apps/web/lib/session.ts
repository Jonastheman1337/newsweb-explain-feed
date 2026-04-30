import { cookies } from "next/headers";
import { SESSION_COOKIE } from "./session-cookie";

export async function getSessionToken(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SESSION_COOKIE)?.value ?? null;
}
