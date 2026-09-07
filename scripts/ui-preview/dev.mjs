import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import net from "node:net";
import { stopChild } from "./process.mjs";
import { createFixtureServer } from "./server.mjs";

const require = createRequire(import.meta.url);
const webDir = fileURLToPath(new URL("../../apps/web", import.meta.url));
// Fail instead of silently moving to another port or an existing application.
const probe = net.createServer();
await new Promise((resolve, reject) => {
  probe.once("error", reject);
  probe.listen(3101, "127.0.0.1", resolve);
});
await new Promise((resolve) => probe.close(resolve));
const fixture = createFixtureServer();
await fixture.listen();
const env = {
  ...process.env,
  NODE_ENV: "development",
  API_BASE_URL: "http://127.0.0.1:4101",
  NEXT_PUBLIC_API_BASE_URL: "http://127.0.0.1:4101",
  UI_V2_ENABLED: "true",
  FAST_DRAFT_ENABLED: "false",
  UI_PREVIEW_FIXTURES: "true",
  SESSION_COOKIE_NAME: "newsweb_ui_preview",
  OPENAI_API_KEY: "preview-disabled",
  OPENAI_BASE_URL: "http://127.0.0.1:4101/disabled",
  DATABASE_URL: "postgresql://preview:preview@127.0.0.1:15433/ui_preview",
  GENERATION_LOG_DATABASE_URL: "postgresql://preview:preview@127.0.0.1:15434/ui_preview_logs",
  REDIS_URL: "redis://127.0.0.1:16380",
  NEWSWEB_POLLING_ENABLED: "false",
  START_WORKER: "false",
  NEXT_TELEMETRY_DISABLED: "1",
  SMTP_HOST: "",
  SMTP_USER: "",
  SMTP_PASS: "",
  ADMIN_API_KEY: "preview-disabled",
  LATEST_BOOTSTRAP_COUNT: "0"
};
const child = spawn(
  process.execPath,
  [require.resolve("next/dist/bin/next"), "dev", "-H", "127.0.0.1", "-p", "3101"],
  { cwd: webDir, env, stdio: "inherit", windowsHide: true }
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  await stopChild(child);
  await fixture.close();
}
child.once("error", async (error) => {
  console.error(error);
  await stop();
  process.exitCode = 1;
});
child.once("exit", async (code) => {
  await stop();
  process.exitCode = code ?? 0;
});
process.once("SIGINT", stop);
process.once("SIGTERM", stop);
console.log(
  "UI preview: http://127.0.0.1:3101/next | preview / ui-preview | fictional fixtures; no worker"
);
