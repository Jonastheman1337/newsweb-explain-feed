export type RedisConnectionOptions = {
  host: string;
  port: number;
  username?: string;
  password?: string;
  db?: number;
  tls?: Record<string, never>;
};

export function parseRedisUrl(redisUrl: string): RedisConnectionOptions {
  const parsed = new URL(redisUrl);
  const db =
    parsed.pathname && parsed.pathname !== "/"
      ? Number(parsed.pathname.replace("/", ""))
      : 0;

  const options: RedisConnectionOptions = {
    host: parsed.hostname,
    port: Number(parsed.port || 6379),
    username: parsed.username ? decodeURIComponent(parsed.username) : undefined,
    password: parsed.password ? decodeURIComponent(parsed.password) : undefined,
    db: Number.isNaN(db) ? 0 : db
  };

  if (parsed.protocol === "rediss:") {
    options.tls = {};
  }

  return options;
}
