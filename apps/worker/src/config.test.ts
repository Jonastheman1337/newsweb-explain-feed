import { describe, expect, it } from "vitest";
import { parseWorkerConfig } from "./config.js";

describe("parseWorkerConfig", () => {
  it("fails when ANTHROPIC_API_KEY is missing", () => {
    expect(() =>
      parseWorkerConfig({
        NODE_ENV: "development",
        DATABASE_URL:
          "postgresql://newsweb:newsweb@localhost:5432/newsweb_explain?schema=public",
        REDIS_URL: "redis://localhost:6379",
        ANTHROPIC_MODEL: "claude-sonnet-4-6",
        ANTHROPIC_TIMEOUT_MS: "15000",
        POLL_INTERVAL_MS: "20000"
      })
    ).toThrow(/ANTHROPIC_KEY_MISSING/);
  });

  it("parses valid config", () => {
    const config = parseWorkerConfig({
      NODE_ENV: "development",
      DATABASE_URL:
        "postgresql://newsweb:newsweb@localhost:5432/newsweb_explain?schema=public",
      REDIS_URL: "redis://localhost:6379",
      ANTHROPIC_API_KEY: "sk-ant-test-key",
      ANTHROPIC_MODEL: "claude-sonnet-4-6",
      ANTHROPIC_TIMEOUT_MS: "60000",
      POLL_INTERVAL_MS: "20000"
    });
    expect(config.ANTHROPIC_MODEL).toBe("claude-sonnet-4-6");
    expect(config.ANTHROPIC_TIMEOUT_MS).toBe(60000);
  });
});
