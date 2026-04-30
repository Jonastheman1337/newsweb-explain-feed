import { describe, expect, it } from "vitest";
import { parseAppConfig } from "./config.js";

function baseEnv(overrides?: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  return {
    NODE_ENV: "development",
    API_PORT: "4000",
    DATABASE_URL: "postgresql://newsweb:newsweb@localhost:5432/newsweb_explain?schema=public",
    REDIS_URL: "redis://localhost:6379",
    SESSION_SECRET: "short",
    DEV_AUTH_BYPASS: "true",
    MAGIC_LINK_BASE_URL: "http://localhost:3000/login",
    ADMIN_API_KEY: "change-me-123",
    SMTP_FROM: "noreply@example.com",
    ...overrides
  };
}

describe("parseAppConfig", () => {
  it("allows short SESSION_SECRET in development", () => {
    const cfg = parseAppConfig(baseEnv());
    expect(cfg.SESSION_SECRET).toBe("short");
    expect(cfg.DEV_AUTH_BYPASS).toBe(true);
  });

  it("defaults DEV_AUTH_BYPASS to true in development when missing", () => {
    const cfg = parseAppConfig(
      baseEnv({
        DEV_AUTH_BYPASS: undefined
      })
    );
    expect(cfg.DEV_AUTH_BYPASS).toBe(true);
  });

  it("requires SESSION_SECRET length >= 24 in production", () => {
    expect(() =>
      parseAppConfig(
        baseEnv({
          NODE_ENV: "production",
          SESSION_SECRET: "too-short",
          DEV_AUTH_BYPASS: undefined
        })
      )
    ).toThrow(/SESSION_SECRET must contain at least 24 characters in production/);
  });

  it("defaults DEV_AUTH_BYPASS to false in production when missing", () => {
    const cfg = parseAppConfig(
      baseEnv({
        NODE_ENV: "production",
        SESSION_SECRET: "this-is-a-long-enough-production-secret",
        DEV_AUTH_BYPASS: undefined
      })
    );
    expect(cfg.DEV_AUTH_BYPASS).toBe(false);
  });
});
