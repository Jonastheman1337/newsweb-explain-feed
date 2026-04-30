"use client";

import { useRouter } from "next/navigation";

export function BackButton() {
  const router = useRouter();
  return (
    <button className="ghostButton" onClick={() => router.back()}>
      Forrige side
    </button>
  );
}
