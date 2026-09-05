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

  it("leaves NUMERIC_ACCEPTANCE_RULES undefined when unset (code default applies)", () => {
    const config = parseWorkerConfig({
      NODE_ENV: "development",
      DATABASE_URL:
        "postgresql://newsweb:newsweb@localhost:5432/newsweb_explain?schema=public",
      REDIS_URL: "redis://localhost:6379",
      OPENAI_API_KEY: "sk-openai-test-key"
    });
    expect(config.NUMERIC_ACCEPTANCE_RULES).toBeUndefined();
  });

  it("parses empty NUMERIC_ACCEPTANCE_RULES as the all-off kill switch", () => {
    const config = parseWorkerConfig({
      NODE_ENV: "development",
      DATABASE_URL:
        "postgresql://newsweb:newsweb@localhost:5432/newsweb_explain?schema=public",
      REDIS_URL: "redis://localhost:6379",
      OPENAI_API_KEY: "sk-openai-test-key",
      NUMERIC_ACCEPTANCE_RULES: ""
    });
    expect(config.NUMERIC_ACCEPTANCE_RULES).toEqual([]);
  });

  it("normalizes NUMERIC_ACCEPTANCE_RULES whitespace and empty entries to all-off", () => {
    const config = parseWorkerConfig({
      NODE_ENV: "development",
      DATABASE_URL:
        "postgresql://newsweb:newsweb@localhost:5432/newsweb_explain?schema=public",
      REDIS_URL: "redis://localhost:6379",
      OPENAI_API_KEY: "sk-openai-test-key",
      NUMERIC_ACCEPTANCE_RULES: " , ,"
    });
    expect(config.NUMERIC_ACCEPTANCE_RULES).toEqual([]);
  });

  it("rejects unknown NUMERIC_ACCEPTANCE_RULES ids at boot", () => {
    expect(() =>
      parseWorkerConfig({
        NODE_ENV: "development",
        DATABASE_URL:
          "postgresql://newsweb:newsweb@localhost:5432/newsweb_explain?schema=public",
        REDIS_URL: "redis://localhost:6379",
        OPENAI_API_KEY: "sk-openai-test-key",
        NUMERIC_ACCEPTANCE_RULES: "no_such_rule"
      })
    ).toThrow(/Unknown numeric acceptance rule id/);
  });

  it("leaves REFERENCE_CHECK_ENFORCEMENT undefined when unset (code default applies)", () => {
    const config = parseWorkerConfig({
      NODE_ENV: "development",
      DATABASE_URL:
        "postgresql://newsweb:newsweb@localhost:5432/newsweb_explain?schema=public",
      REDIS_URL: "redis://localhost:6379",
      OPENAI_API_KEY: "sk-openai-test-key"
    });
    expect(config.REFERENCE_CHECK_ENFORCEMENT).toBeUndefined();
  });

  it("parses empty REFERENCE_CHECK_ENFORCEMENT as the full legacy kill switch", () => {
    const config = parseWorkerConfig({
      NODE_ENV: "development",
      DATABASE_URL:
        "postgresql://newsweb:newsweb@localhost:5432/newsweb_explain?schema=public",
      REDIS_URL: "redis://localhost:6379",
      OPENAI_API_KEY: "sk-openai-test-key",
      REFERENCE_CHECK_ENFORCEMENT: ""
    });
    expect(config.REFERENCE_CHECK_ENFORCEMENT).toEqual({
      blockOnResidualUnsupported: false,
      retryOnUnavailable: false
    });
  });

  it("parses a partial REFERENCE_CHECK_ENFORCEMENT flag set", () => {
    const config = parseWorkerConfig({
      NODE_ENV: "development",
      DATABASE_URL:
        "postgresql://newsweb:newsweb@localhost:5432/newsweb_explain?schema=public",
      REDIS_URL: "redis://localhost:6379",
      OPENAI_API_KEY: "sk-openai-test-key",
      REFERENCE_CHECK_ENFORCEMENT: "retry_on_unavailable"
    });
    expect(config.REFERENCE_CHECK_ENFORCEMENT).toEqual({
      blockOnResidualUnsupported: false,
      retryOnUnavailable: true
    });
  });

  it("parses TRIAGE_SKIP_CLASSES like the other kill switches", () => {
    const base = {
      NODE_ENV: "development",
      DATABASE_URL:
        "postgresql://newsweb:newsweb@localhost:5432/newsweb_explain?schema=public",
      REDIS_URL: "redis://localhost:6379",
      OPENAI_API_KEY: "sk-openai-test-key"
    };
    expect(parseWorkerConfig(base).TRIAGE_SKIP_CLASSES).toBeUndefined();
    expect(
      parseWorkerConfig({ ...base, TRIAGE_SKIP_CLASSES: "" }).TRIAGE_SKIP_CLASSES
    ).toEqual([]);
    expect(
      parseWorkerConfig({
        ...base,
        TRIAGE_SKIP_CLASSES: "document-only, small-routine-bond"
      }).TRIAGE_SKIP_CLASSES
    ).toEqual(["document-only", "small-routine-bond"]);
    expect(() =>
      parseWorkerConfig({ ...base, TRIAGE_SKIP_CLASSES: "no_such_class" })
    ).toThrow(/Unknown triage skip class id/);
  });

  it("parses RELATED_NOTICE_CONTEXT like the other kill switches", () => {
    const base = {
      NODE_ENV: "development",
      DATABASE_URL:
        "postgresql://newsweb:newsweb@localhost:5432/newsweb_explain?schema=public",
      REDIS_URL: "redis://localhost:6379",
      OPENAI_API_KEY: "sk-openai-test-key"
    };
    expect(parseWorkerConfig(base).RELATED_NOTICE_CONTEXT).toBeUndefined();
    expect(
      parseWorkerConfig({ ...base, RELATED_NOTICE_CONTEXT: "" })
        .RELATED_NOTICE_CONTEXT
    ).toEqual([]);
    expect(
      parseWorkerConfig({
        ...base,
        RELATED_NOTICE_CONTEXT: "reference, sibling"
      }).RELATED_NOTICE_CONTEXT
    ).toEqual(["reference", "sibling"]);
    expect(() =>
      parseWorkerConfig({ ...base, RELATED_NOTICE_CONTEXT: "no_such_relation" })
    ).toThrow(/Unknown related notice relation/);
  });

  it("rejects unknown REFERENCE_CHECK_ENFORCEMENT flags at boot", () => {
    expect(() =>
      parseWorkerConfig({
        NODE_ENV: "development",
        DATABASE_URL:
          "postgresql://newsweb:newsweb@localhost:5432/newsweb_explain?schema=public",
        REDIS_URL: "redis://localhost:6379",
        OPENAI_API_KEY: "sk-openai-test-key",
        REFERENCE_CHECK_ENFORCEMENT: "no_such_flag"
      })
    ).toThrow(/Unknown reference-check enforcement flag/);
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
