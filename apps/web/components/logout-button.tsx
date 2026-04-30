"use client";

import { useRouter } from "next/navigation";
import { SESSION_COOKIE } from "../lib/session-cookie";

export function LogoutButton() {
  const router = useRouter();

  return (
    <button
      className="ghostButton"
      type="button"
      onClick={() => {
        document.cookie = `${SESSION_COOKIE}=; path=/; max-age=0; samesite=lax`;
        router.replace("/login");
      }}
    >
      Logg ut
    </button>
  );
}
