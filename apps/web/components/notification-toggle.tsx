"use client";

import { useEffect, useState } from "react";
import { useFeedStreamSubscription } from "./feed-stream-provider";

export function NotificationToggle() {
  const [enabled, setEnabled] = useState(false);
  const [supported, setSupported] = useState(true);

  // Check support + restore state after mount (avoids hydration mismatch)
  useEffect(() => {
    if (typeof Notification === "undefined") {
      setSupported(false);
      return;
    }
    if (Notification.permission === "denied") {
      setSupported(false);
      return;
    }
    const stored = localStorage.getItem("notifications");
    if (stored === "on" && Notification.permission === "granted") {
      setEnabled(true);
    }
  }, []);

  useFeedStreamSubscription(
    {
      onItem: (item) => {
        new Notification(item.title, {
          body: item.issuerName,
          tag: String(item.messageId),
          icon: "/favicon.ico"
        });
      }
    },
    enabled
  );

  async function toggle() {
    if (enabled) {
      setEnabled(false);
      localStorage.setItem("notifications", "off");
      return;
    }

    if (typeof Notification === "undefined") return;

    let perm = Notification.permission;
    if (perm === "default") {
      perm = await Notification.requestPermission();
    }

    if (perm === "granted") {
      setEnabled(true);
      localStorage.setItem("notifications", "on");
    } else if (perm === "denied") {
      setSupported(false);
    }
  }

  if (!supported) {
    return null;
  }

  return (
    <button
      className="themeToggle"
      onClick={toggle}
      aria-label={enabled ? "Slå av varsler" : "Slå på varsler"}
      title={enabled ? "Varsler på" : "Varsler av"}
    >
      <svg
        width="16"
        height="16"
        viewBox="0 0 24 24"
        style={{ display: "block" }}
        fill={enabled ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </svg>
    </button>
  );
}
