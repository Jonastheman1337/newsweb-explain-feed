"use client";
import { useFeedConnection } from "../feed-stream-provider";
import styles from "./refresh.module.css";
export function FeedConnection({ fixtures }: { fixtures: boolean }) {
  const { state, reconnect } = useFeedConnection();
  return (
    <div className={styles.connection}>
      <span className={styles.live} data-state={state} role="status">
        {state === "connected"
          ? fixtures
            ? "Eksempeldata"
            : "Direkte"
          : state === "connecting"
            ? "Kobler til"
            : "Frakoblet"}
      </span>
      {state === "disconnected" && (
        <button type="button" onClick={reconnect}>
          Koble til
        </button>
      )}
    </div>
  );
}
