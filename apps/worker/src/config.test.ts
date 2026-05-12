import { describe, expect, it } from "vitest";
import { parseWorkerConfig } from "./config.js";

describe("parseWorkerConfig", () => {
  it("fails when LITELLM_API_KEY is missing", () => {
    expect(() =>
      parseWorkerConfig({
        NODE_ENV: "development",
        DATABASE_URL:
          "postgresql://newsweb:newsweb@localhost:5432/newsweb_explain?schema=public",
        REDIS_URL: "redis://localhost:6379",
        LITELLM_BASE_URL: "https://litellm.example.com/v1",
        LITELLM_MODEL: "claude-sonnet-4-6",
        LITELLM_TIMEOUT_MS: "15000",
        POLL_INTERVAL_MS: "20000"
      })
    ).toThrow(/LITELLM_KEY_MISSING/);
  });

  it("parses valid config", () => {
    const config = parseWorkerConfig({
      NODE_ENV: "development",
      DATABASE_URL:
        "postgresql://newsweb:newsweb@localhost:5432/newsweb_explain?schema=public",
      REDIS_URL: "redis://localhost:6379",
      LITELLM_API_KEY: "sk-litellm-test-key",
      LITELLM_BASE_URL: "https://litellm.example.com/v1",
      LITELLM_MODEL: "claude-sonnet-4-6",
      LITELLM_TIMEOUT_MS: "60000",
      POLL_INTERVAL_MS: "20000"
    });
    expect(config.LITELLM_MODEL).toBe("claude-sonnet-4-6");
    expect(config.LITELLM_TIMEOUT_MS).toBe(60000);
  });

  it("uses legacy model and timeout env names as fallbacks", () => {
    const config = parseWorkerConfig({
      NODE_ENV: "development",
      DATABASE_URL:
        "postgresql://newsweb:newsweb@localhost:5432/newsweb_explain?schema=public",
      REDIS_URL: "redis://localhost:6379",
      LITELLM_API_KEY: "sk-litellm-test-key",
      LITELLM_API_BASE: "https://litellm.example.com/v1",
      ANTHROPIC_MODEL: "claude-sonnet-4-6",
      ANTHROPIC_TIMEOUT_MS: "15000",
      POLL_INTERVAL_MS: "20000"
    });
    expect(config.LITELLM_BASE_URL).toBe("https://litellm.example.com/v1");
    expect(config.LITELLM_MODEL).toBe("claude-sonnet-4-6");
    expect(config.LITELLM_TIMEOUT_MS).toBe(15000);
  });
});
