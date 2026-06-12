import { describe, expect, it } from "vitest";
import {
  parseRedisUrl,
  stripPostgresNullCharacters,
  toPrismaJsonValue
} from "@newsweb/shared";

describe("shared Redis parsing", () => {
  it("parses non-TLS redis URLs without TLS options", () => {
    expect(parseRedisUrl("redis://user:pa%40ss@localhost:6380/2")).toEqual({
      host: "localhost",
      port: 6380,
      username: "user",
      password: "pa@ss",
      db: 2
    });
  });

  it("preserves TLS for rediss URLs used by Render Key Value", () => {
    expect(parseRedisUrl("rediss://default:secret@example.render.com:6379/0")).toEqual({
      host: "example.render.com",
      port: 6379,
      username: "default",
      password: "secret",
      db: 0,
      tls: {}
    });
  });
});

describe("shared Prisma JSON sanitizing", () => {
  it("strips actual Postgres null characters from nested strings", () => {
    expect(
      toPrismaJsonValue({
        title: "A\0B",
        nested: ["C\0D", { value: "E\0F" }]
      })
    ).toEqual({
      title: "AB",
      nested: ["CD", { value: "EF" }]
    });
  });

  it("does not strip the literal escaped null sequence", () => {
    expect(stripPostgresNullCharacters("\\u0000")).toBe("\\u0000");
  });
});

