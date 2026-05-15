import { describe, expect, it } from "vitest";
import { parseWorkerConfig } from "./config.js";

describe("parseWorkerConfig", () => {
  it("fails when OPENAI_API_KEY is missing", () => {
    expect(() =>
      parseWorkerConfig({
        NODE_ENV: "development",
        DATABASE_URL:
          "postgresql://newsweb:newsweb@localhost:5432/newsweb_explain?schema=public",
        REDIS_URL: "redis://localhost:6379",
        OPENAI_MODEL: "gpt-5.5",
        OPENAI_TIMEOUT_MS: "15000",
        POLL_INTERVAL_MS: "20000"
      })
    ).toThrow(/OPENAI_KEY_MISSING/);
  });

  it("parses valid config", () => {
    const config = parseWorkerConfig({
      NODE_ENV: "development",
      DATABASE_URL:
        "postgresql://newsweb:newsweb@localhost:5432/newsweb_explain?schema=public",
      REDIS_URL: "redis://localhost:6379",
      OPENAI_API_KEY: "sk-openai-test-key",
      OPENAI_MODEL: "gpt-5.5",
      OPENAI_FAST_MODEL: "gpt-5.4-mini",
      OPENAI_TIMEOUT_MS: "60000",
      OPENAI_FAST_TIMEOUT_MS: "15000",
      OPENAI_DEFAULT_REASONING_EFFORT: "low",
      OPENAI_REPORT_REASONING_EFFORT: "medium",
      OPENAI_HARD_REASONING_EFFORT: "high",
      POLL_INTERVAL_MS: "20000"
    });
    expect(config.OPENAI_MODEL).toBe("gpt-5.5");
    expect(config.OPENAI_FAST_MODEL).toBe("gpt-5.4-mini");
    expect(config.OPENAI_TIMEOUT_MS).toBe(60000);
    expect(config.OPENAI_FAST_TIMEOUT_MS).toBe(15000);
    expect(config.OPENAI_DEFAULT_REASONING_EFFORT).toBe("low");
    expect(config.OPENAI_REPORT_REASONING_EFFORT).toBe("medium");
    expect(config.OPENAI_HARD_REASONING_EFFORT).toBe("high");
  });

  it("uses OpenAI defaults for model and reasoning settings", () => {
    const config = parseWorkerConfig({
      NODE_ENV: "development",
      DATABASE_URL:
        "postgresql://newsweb:newsweb@localhost:5432/newsweb_explain?schema=public",
      REDIS_URL: "redis://localhost:6379",
      OPENAI_API_KEY: "sk-openai-test-key",
      POLL_INTERVAL_MS: "20000"
    });
    expect(config.OPENAI_MODEL).toBe("gpt-5.5");
    expect(config.OPENAI_FAST_MODEL).toBe("gpt-5.4-mini");
    expect(config.OPENAI_TIMEOUT_MS).toBe(60000);
    expect(config.OPENAI_FAST_TIMEOUT_MS).toBe(15000);
    expect(config.OPENAI_DEFAULT_REASONING_EFFORT).toBe("low");
    expect(config.OPENAI_REPORT_REASONING_EFFORT).toBe("medium");
    expect(config.OPENAI_HARD_REASONING_EFFORT).toBe("high");
    expect(config.LATEST_BOOTSTRAP_COUNT).toBe(30);
  });
});
