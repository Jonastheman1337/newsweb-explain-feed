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
        POLL_INTERVAL_MS: "5000"
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
      OPENAI_HARD_MODEL: "gpt-5.5",
      OPENAI_SERVICE_TIER: "default",
      OPENAI_TIMEOUT_MS: "60000",
      OPENAI_FAST_TIMEOUT_MS: "15000",
      OPENAI_DEFAULT_REASONING_EFFORT: "high",
      OPENAI_REPORT_REASONING_EFFORT: "high",
      OPENAI_HARD_REASONING_EFFORT: "medium",
      OPENAI_TRIAGE_REASONING_EFFORT: "low",
      OPENAI_REFERENCE_REASONING_EFFORT: "high",
      OPENAI_REVIEW_REASONING_EFFORT: "low",
      POLL_INTERVAL_MS: "5000"
    });
    expect(config.OPENAI_MODEL).toBe("gpt-5.5");
    expect(config.OPENAI_FAST_MODEL).toBe("gpt-5.4-mini");
    expect(config.OPENAI_HARD_MODEL).toBe("gpt-5.5");
    expect(config.OPENAI_SERVICE_TIER).toBe("default");
    expect(config.OPENAI_TIMEOUT_MS).toBe(60000);
    expect(config.OPENAI_FAST_TIMEOUT_MS).toBe(15000);
    expect(config.OPENAI_DEFAULT_REASONING_EFFORT).toBe("high");
    expect(config.OPENAI_REPORT_REASONING_EFFORT).toBe("high");
    expect(config.OPENAI_HARD_REASONING_EFFORT).toBe("medium");
    expect(config.OPENAI_TRIAGE_REASONING_EFFORT).toBe("low");
    expect(config.OPENAI_REFERENCE_REASONING_EFFORT).toBe("high");
    expect(config.OPENAI_REVIEW_REASONING_EFFORT).toBe("low");
    expect(config.NEWSWEB_POLLING_ENABLED).toBe(true);
    expect(config.POLL_INTERVAL_MS).toBe(5000);
  });

  it("uses OpenAI defaults for model and reasoning settings", () => {
    const config = parseWorkerConfig({
      NODE_ENV: "development",
      DATABASE_URL:
        "postgresql://newsweb:newsweb@localhost:5432/newsweb_explain?schema=public",
      REDIS_URL: "redis://localhost:6379",
      OPENAI_API_KEY: "sk-openai-test-key"
    });
    expect(config.OPENAI_MODEL).toBe("gpt-5.6-terra");
    expect(config.OPENAI_FAST_MODEL).toBe("gpt-5.6-luna");
    expect(config.OPENAI_HARD_MODEL).toBe("gpt-5.6-sol");
    expect(config.OPENAI_SERVICE_TIER).toBe("default");
    expect(config.OPENAI_TIMEOUT_MS).toBe(240000);
    expect(config.OPENAI_FAST_TIMEOUT_MS).toBe(15000);
    expect(config.OPENAI_DEFAULT_REASONING_EFFORT).toBe("medium");
    expect(config.OPENAI_REPORT_REASONING_EFFORT).toBe("medium");
    expect(config.OPENAI_HARD_REASONING_EFFORT).toBe("xhigh");
    expect(config.OPENAI_TRIAGE_REASONING_EFFORT).toBe("none");
    expect(config.OPENAI_REFERENCE_REASONING_EFFORT).toBe("medium");
    expect(config.OPENAI_REVIEW_REASONING_EFFORT).toBe("medium");
    expect(config.NEWSWEB_POLLING_ENABLED).toBe(true);
    expect(config.POLL_INTERVAL_MS).toBe(5000);
    expect(config.LATEST_BOOTSTRAP_COUNT).toBe(30);
  });

  it("can disable Newsweb polling", () => {
    const config = parseWorkerConfig({
      NODE_ENV: "development",
      DATABASE_URL:
        "postgresql://newsweb:newsweb@localhost:5432/newsweb_explain?schema=public",
      REDIS_URL: "redis://localhost:6379",
      OPENAI_API_KEY: "sk-openai-test-key",
      NEWSWEB_POLLING_ENABLED: "false"
    });
    expect(config.NEWSWEB_POLLING_ENABLED).toBe(false);
  });

  it("rejects poll intervals below 5 seconds", () => {
    expect(() =>
      parseWorkerConfig({
        NODE_ENV: "development",
        DATABASE_URL:
          "postgresql://newsweb:newsweb@localhost:5432/newsweb_explain?schema=public",
        REDIS_URL: "redis://localhost:6379",
        OPENAI_API_KEY: "sk-openai-test-key",
        POLL_INTERVAL_MS: "4999"
      })
    ).toThrow();
  });

  it("defaults prompt cache mode to implicit with no per-flow overrides", () => {
    const config = parseWorkerConfig({
      NODE_ENV: "development",
      DATABASE_URL:
        "postgresql://newsweb:newsweb@localhost:5432/newsweb_explain?schema=public",
      REDIS_URL: "redis://localhost:6379",
      OPENAI_API_KEY: "sk-openai-test-key"
    });
    expect(config.OPENAI_PROMPT_CACHE_MODE).toBe("implicit");
    expect(config.OPENAI_PROMPT_CACHE_MODE_TRIAGE).toBeUndefined();
    expect(config.OPENAI_PROMPT_CACHE_MODE_EDITORIAL_REVIEW).toBeUndefined();
    expect(config.OPENAI_PROMPT_CACHE_MODE_REWRITE_REGULAR).toBeUndefined();
    expect(config.OPENAI_PROMPT_CACHE_MODE_REFERENCE_CHECK).toBeUndefined();
    expect(config.OPENAI_PROMPT_CACHE_MODE_REWRITE_REPORT).toBeUndefined();
    expect(config.OPENAI_PROMPT_CACHE_MODE_REWRITE_YEARLY).toBeUndefined();
    expect(config.OPENAI_PROMPT_CACHE_MODE_PDF_CONTEXT).toBeUndefined();
  });

  it("parses per-flow prompt cache mode overrides", () => {
    const config = parseWorkerConfig({
      NODE_ENV: "development",
      DATABASE_URL:
        "postgresql://newsweb:newsweb@localhost:5432/newsweb_explain?schema=public",
      REDIS_URL: "redis://localhost:6379",
      OPENAI_API_KEY: "sk-openai-test-key",
      OPENAI_PROMPT_CACHE_MODE_PDF_CONTEXT: "off",
      OPENAI_PROMPT_CACHE_MODE_REWRITE_REGULAR: "explicit"
    });
    expect(config.OPENAI_PROMPT_CACHE_MODE).toBe("implicit");
    expect(config.OPENAI_PROMPT_CACHE_MODE_PDF_CONTEXT).toBe("off");
    expect(config.OPENAI_PROMPT_CACHE_MODE_REWRITE_REGULAR).toBe("explicit");
  });

  it("rejects unknown prompt cache modes", () => {
    expect(() =>
      parseWorkerConfig({
        NODE_ENV: "development",
        DATABASE_URL:
          "postgresql://newsweb:newsweb@localhost:5432/newsweb_explain?schema=public",
        REDIS_URL: "redis://localhost:6379",
        OPENAI_API_KEY: "sk-openai-test-key",
        OPENAI_PROMPT_CACHE_MODE: "disabled"
      })
    ).toThrow();
  });

  it("rejects reasoning efforts unsupported by the selected model family", () => {
    expect(() =>
      parseWorkerConfig({
        NODE_ENV: "development",
        DATABASE_URL:
          "postgresql://newsweb:newsweb@localhost:5432/newsweb_explain?schema=public",
        REDIS_URL: "redis://localhost:6379",
        OPENAI_API_KEY: "sk-openai-test-key",
        OPENAI_MODEL: "gpt-5.6-terra",
        OPENAI_TRIAGE_REASONING_EFFORT: "minimal"
      })
    ).toThrow(/does not support reasoning effort minimal/);
  });
});
