// Run after `npm run build -w apps/web`, with no dev server writing .next.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { setTimeout as delay } from "node:timers/promises";
import { createFixtureServer } from "./server.mjs";
import { stopChild } from "./process.mjs";

const require = createRequire(import.meta.url);
const fixture = createFixtureServer();
const apiPort = await fixture.listen(0);
const webPort = process.env.UI_VERIFY_PORT || "3102";
const base = `http://127.0.0.1:${webPort}`;
try {
  for (const enabled of [false, true]) {
    let output = "";
    const child = spawn(
      process.execPath,
      [require.resolve("next/dist/bin/next"), "start", "-H", "127.0.0.1", "-p", webPort],
      {
        cwd: fileURLToPath(new URL("../../apps/web", import.meta.url)),
        windowsHide: true,
        env: {
          ...process.env,
          NODE_ENV: "production",
          API_BASE_URL: `http://127.0.0.1:${apiPort}`,
          UI_V2_ENABLED: String(enabled),
          FAST_DRAFT_ENABLED: "false",
          SESSION_COOKIE_NAME: "newsweb_ui_gate_test",
          NEXT_TELEMETRY_DISABLED: "1"
        },
        stdio: ["ignore", "pipe", "pipe"]
      }
    );
    child.stdout.on("data", (data) => {
      output += data;
    });
    child.stderr.on("data", (data) => {
      output += data;
    });
    try {
      const deadline = Date.now() + 30000;
      while (!output.includes("Ready in")) {
        if (child.exitCode !== null || Date.now() > deadline)
          throw new Error(output || "Next startup timed out");
        await delay(100);
      }
      const loggedOut = await fetch(`${base}/next`, { redirect: "manual" });
      assert.equal(loggedOut.status, enabled ? 307 : 404, `logged out, flag=${enabled}`);
      if (enabled) assert.match(loggedOut.headers.get("location"), /\/login\?next=\/next$/);
      const login = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        body: JSON.stringify({ username: "preview", password: "ui-preview" })
      });
      assert.equal(login.status, 200);
      const cookie = login.headers.get("set-cookie").split(";")[0];
      assert.match(cookie, /^newsweb_ui_gate_test=/);
      const headers = { Cookie: cookie };
      const next = await fetch(`${base}/next`, { headers, redirect: "manual" });
      assert.equal(next.status, enabled ? 200 : 404, `logged in, flag=${enabled}`);
      const html = await next.text();
      if (enabled) assert.ok(html.includes("Nordvik sikrer kontrakt"));
      const detail = await fetch(base + "/api/notice/900001", { headers });
      assert.equal(detail.status, 200);
      assert.equal((await detail.json()).rewrites.length, 1);
      assert.equal((await fetch(base + "/api/notice/900001")).status, 401);
      assert.equal((await fetch(base + "/api/notice/not-an-id", { headers })).status, 400);
      const legacy = await fetch(`${base}/feed`, { headers });
      assert.equal(legacy.status, 200);
      assert.ok((await legacy.text()).includes("Nordvik sikrer kontrakt"));
      if (enabled) {
        const invalid = await fetch(`${base}/next`, {
          headers: { Cookie: "newsweb_ui_gate_test=invalid" },
          redirect: "manual"
        });
        assert.equal(invalid.status, 307);
        assert.match(invalid.headers.get("location"), /\/login/);
      }
      console.log(
        `Route gates passed: UI=${enabled}; authenticated new/legacy feeds and isolated cookie`
      );
    } finally {
      await stopChild(child);
    }
  }
} finally {
  await fixture.close();
}
