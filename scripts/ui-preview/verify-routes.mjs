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
      const loggedOut = await fetch(`${base}/`, { redirect: "manual" });
      assert.equal(loggedOut.status, 307, `logged out, flag=${enabled}`);
      assert.match(loggedOut.headers.get("location"), /\/login$/);
      for (const alias of ["/next", "/feed"]) {
        const response = await fetch(base + alias + "?q=Equinor&generated=1&cursorId=123", { redirect: "manual" });
        assert.equal(response.status, 307);
        const destination = new URL(response.headers.get("location"), base);
        assert.equal(destination.pathname, "/");
        assert.equal(destination.searchParams.get("q"), "Equinor");
        assert.equal(destination.searchParams.get("generated"), "1");
        assert.equal(destination.searchParams.get("cursorId"), "123");
      }
      const login = await fetch(`${base}/api/auth/login`, {
        method: "POST",
        body: JSON.stringify({ username: "preview", password: "ui-preview" })
      });
      assert.equal(login.status, 200);
      const cookie = login.headers.get("set-cookie").split(";")[0];
      assert.match(cookie, /^newsweb_ui_gate_test=/);
      const headers = { Cookie: cookie };
      const next = await fetch(`${base}/`, { headers, redirect: "manual" });
      assert.equal(next.status, 200, `logged in, flag=${enabled}`);
      const html = await next.text();
      assert.ok(html.includes("Nordvik sikrer kontrakt"));
      const detail = await fetch(base + "/api/notice/900001", { headers });
      assert.equal(detail.status, 200);
      assert.equal((await detail.json()).rewrites.length, 1);
      assert.equal((await fetch(base + "/api/notice/900001")).status, 401);
      assert.equal((await fetch(base + "/api/notice/not-an-id", { headers })).status, 400);
      const legacy = await fetch(`${base}/legacy`, { headers });
      assert.equal(legacy.status, 200);
      const legacyHtml = await legacy.text();
      assert.ok(legacyHtml.includes("Nordvik sikrer kontrakt"));
      assert.ok(legacyHtml.includes("Oppdater feed"));
      assert.ok(html.includes('action="/"'));
      assert.ok(html.includes('href="/legacy"'));
      const notice = await fetch(base + "/notice/900001?from=" + encodeURIComponent("/legacy?q=Equinor"), { headers });
      assert.equal(notice.status, 200);
      assert.ok((await notice.text()).includes('href="/legacy?q=Equinor"'));
      {
        const invalid = await fetch(`${base}/`, {
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
