import test from "node:test";
import assert from "node:assert/strict";
import { createFixtureServer } from "./server.mjs";
import { feedResponseSchema, noticeResponseSchema } from "../../packages/shared/dist/api.js";

test("fixture preview authenticates, filters, paginates and simulates generation locally", async (t) => {
  const fixture = createFixtureServer();
  const port = await fixture.listen(0);
  t.after(() => fixture.close());
  const base = `http://127.0.0.1:${port}`;
  assert.equal((await fetch(`${base}/feed`)).status, 401);
  const login = await fetch(`${base}/auth/login`, {
    method: "POST",
    body: JSON.stringify({ username: "preview", password: "ui-preview" })
  });
  const { sessionToken } = await login.json();
  const headers = { Authorization: `Bearer ${sessionToken}` };
  const full = feedResponseSchema.parse(await (await fetch(`${base}/feed`, { headers })).json());
  assert.equal(full.items.length, 3);
  const first = await (await fetch(`${base}/feed?limit=1`, { headers })).json();
  assert.equal(first.items.length, 1);
  const second = await (
    await fetch(`${base}/feed?limit=1&cursor=${first.nextCursor}&cursorId=${first.nextCursorId}`, {
      headers
    })
  ).json();
  assert.notEqual(first.items[0].messageId, second.items[0].messageId);
  const searched = await (await fetch(`${base}/feed?q=Fjord`, { headers })).json();
  assert.equal(searched.items.length, 1);
  noticeResponseSchema.parse(await (await fetch(`${base}/notice/900001`, { headers })).json());
  assert.equal(
    (await fetch(`${base}/notice/900001/generate`, { method: "POST", headers })).status,
    200
  );
  const status = await (await fetch(`${base}/notice/900001/status`, { headers })).json();
  assert.equal(status.ready, false);
  assert.equal(status.jobState, "active");
  assert.equal(
    (
      await fetch(`${base}/__preview/replay`, {
        method: "POST",
        headers: { Origin: "https://other.example" }
      })
    ).status,
    403
  );
});

test("fixture stream carries a full publication update and an arrival", async (t) => {
  const fixture = createFixtureServer();
  const port = await fixture.listen(0);
  t.after(() => fixture.close());
  const base = `http://127.0.0.1:${port}`;
  const { sessionToken } = await (
    await fetch(`${base}/auth/login`, {
      method: "POST",
      body: JSON.stringify({ username: "preview", password: "ui-preview" })
    })
  ).json();
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(`${base}/feed/stream`, {
    headers: { Authorization: `Bearer ${sessionToken}` },
    signal: controller.signal
  });
  const reader = response.body.getReader();
  await fetch(`${base}/__preview/replay`, { method: "POST" });
  let output = "";
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    while (!output.includes("Vestby Teknologi")) {
      const { value, done } = await reader.read();
      if (done) break;
      output += new TextDecoder().decode(value);
    }
    assert.match(output, /"regenerating":true/);
    assert.match(output, /"rewriteId":"fixture-900001-2"/);
    assert.match(output, /Vestby Teknologi/);
    const notice = noticeResponseSchema.parse(
      await (
        await fetch(`${base}/notice/900001`, {
          headers: { Authorization: `Bearer ${sessionToken}` }
        })
      ).json()
    );
    assert.deepEqual(
      notice.rewrites.map((item) => item.version),
      [1, 2]
    );
    assert.equal(notice.publication.version, 2);
  } finally {
    clearTimeout(timeout);
    controller.abort();
  }
});
