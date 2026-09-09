import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import http from "node:http";

// This suite is deliberately opt-in and refuses non-local/non-test databases.
const databaseUrl = process.env.NEXT_EDITOR_TEST_DATABASE_URL;
const redisUrl = process.env.NEXT_EDITOR_TEST_REDIS_URL;
if (!databaseUrl || !redisUrl)
  throw new Error(
    "Set NEXT_EDITOR_TEST_DATABASE_URL and NEXT_EDITOR_TEST_REDIS_URL to isolated local test services.",
  );
for (const value of [databaseUrl, redisUrl])
  assert.ok(
    ["127.0.0.1", "localhost"].includes(new URL(value).hostname),
    "Only loopback integration services are allowed",
  );
assert.match(
  new URL(databaseUrl).pathname,
  /_test$/,
  "Use a dedicated *_test database",
);
process.env.DATABASE_URL = databaseUrl;
process.env.GENERATION_LOG_DATABASE_URL = databaseUrl;
const { PrismaClient } = await import("@prisma/client");
const { Queue, Worker } = await import("bullmq");
const { Redis } = await import("ioredis");
const { default: Fastify } = await import("fastify");
const { default: OpenAI } = await import("openai");
const { noticeRoutes } = await import("../apps/api/dist/routes/notice.js");
const { prisma, logPrisma } = await import("../packages/shared/dist/db.js");
const { createNoticeGenerationRuntime } =
  await import("../apps/worker/dist/services/notice-generation-runtime.js");
const { finalizePublication, publicationContentHash } =
  await import("../apps/worker/dist/services/publication.js");
const {
  createGenerationRequest,
  cancelGenerationRequest,
  admitGenerationRequest,
  acknowledgeGenerationCancellation,
  generationJobId,
} = await import("../packages/shared/dist/generation-control.js");
const { callOpenAIForJson } =
  await import("../packages/shared/dist/openai-responses.js");
const { throwIfGenerationCancelled } =
  await import("../packages/shared/dist/generation-context.js");
const db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
const connection = new Redis(redisUrl, { maxRetriesPerRequest: null });
const suffix = `next-editor-test-${process.pid}-${randomUUID()}`;
const rewriteQueue = new Queue(`${suffix}-rewrite`, { connection });
const publishQueue = new Queue(`${suffix}-publish`, { connection });
const notices = [];
let messageSequence = 1_700_000_000 + Math.floor(Math.random() * 100_000);
const requests = [],
  executions = [],
  aborted = [];
let failModels = false;
const original = {
  title: "Test ASA inngår en avtale",
  lead: "Test ASA har inngått en treårig avtale, ifølge en børsmelding.",
  body: ["Leveransene starter i januar neste år."],
  company_sentence: "",
  key_facts: ["Avtalen gjelder i tre år."],
  negative_or_surprising: [],
  excluded_hype: [],
  source_limitations: [],
  confidence: "high",
  importance: "medium",
  source_spans: ["Test ASA har inngått en treårig avtale."],
};
const model = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const body = JSON.parse(Buffer.concat(chunks));
  requests.push(body);
  const text = JSON.stringify(body);
  let done = false;
  res.on("close", () => {
    if (!done) aborted.push(body);
  });
  setTimeout(
    () => {
      if (res.destroyed) return;
      done = true;
      if (failModels) {
        res.writeHead(500, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({ error: { message: "Deliberate test failure" } }),
        );
        return;
      }
      const output = JSON.stringify(original);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          id: randomUUID(),
          object: "response",
          status: "completed",
          model: "fixture",
          output_text: output,
          output: [
            {
              type: "message",
              role: "assistant",
              content: [{ type: "output_text", text: output, annotations: [] }],
            },
          ],
          usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 },
        }),
      );
    },
    text.includes("SLOW") ? 3500 : 80,
  );
});
let runtime, rewriteWorker, publishWorker, client, app;
async function waitFor(fn, label, timeout = 18000) {
  const until = Date.now() + timeout;
  while (Date.now() < until) {
    const value = await fn();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error(`Timed out: ${label}`);
}
function startRuntime() {
  runtime = createNoticeGenerationRuntime({
    db,
    logDb: db,
    rewriteQueue,
    publishQueue,
    redis: connection,
    notify: async () => {},
  });
  runtime.start();
  return runtime;
}
function startWorker() {
  rewriteWorker = new Worker(
    rewriteQueue.name,
    (job, token) =>
      runtime.run(job, token, async () => {
        const data = structuredClone(job.data);
        executions.push(data);
        await callOpenAIForJson(client, {
          model: "gpt-5.4",
          schemaName: "integration",
          schema: { type: "object" },
          systemPrompt: "",
          developerPrompt: "",
          userPrompt: JSON.stringify(data),
          reasoningEffort: "none",
          timeoutMs: 10000,
          maxOutputTokens: 1000,
        });
        throwIfGenerationCancelled();
        const rewrite = {
          ...original,
          title: data.previousRewriteJson?.title ?? original.title,
        };
        await db.rewrite.upsert({
          where: {
            messageId_version: {
              messageId: data.messageId,
              version: data.targetVersion,
            },
          },
          create: {
            messageId: data.messageId,
            version: data.targetVersion,
            generationRunId: data.generationRunId,
            lang: "nb",
            model: "fixture",
            promptVersion: "fixture",
            rewriteJson: rewrite,
            validationJson: { valid: true },
            status: "pending",
          },
          update: { rewriteJson: rewrite, status: "pending" },
        });
        // Runtime recovery also handles a crash between candidate persistence and enqueue.
        await publishQueue.add("publish", {
          messageId: data.messageId,
          version: data.targetVersion,
          generationRunId: data.generationRunId,
        });
      }),
    { connection, concurrency: 3 },
  );
  rewriteWorker.on("error", () => {});
}
function startPublisher() {
  publishWorker = new Worker(
    publishQueue.name,
    async (job) => {
      await finalizePublication(db, job.data);
      await db.feedItem.updateMany({
        where: {
          messageId: job.data.messageId,
          activeGenerationRunId: job.data.generationRunId,
        },
        data: { activeGenerationRunId: null },
      });
    },
    { connection, concurrency: 3 },
  );
  publishWorker.on("error", () => {});
}
async function seed() {
  const messageId = messageSequence++;
  notices.push(messageId);
  await db.sourceNotice.create({
    data: {
      messageId,
      newsId: messageId,
      title: "Test source",
      issuerName: "Test ASA",
      issuerSign: "TEST",
      publishedAt: new Date(),
      categoriesJson: [],
      marketsJson: [],
      bodyText: "Test source with an agreement.",
      hasAttachments: false,
      rawMessageJson: {},
    },
  });
  const publication = await db.publishedRewrite.create({
    data: {
      messageId,
      version: 1,
      lang: "nb",
      model: "fixture",
      promptVersion: "fixture",
      rewriteJson: original,
      validationJson: { valid: true },
      contentHash: publicationContentHash(original),
    },
  });
  await db.feedItem.create({
    data: {
      messageId,
      publishedAt: new Date(),
      activePublishedRewriteId: publication.id,
      nextRewriteVersion: 2,
      publicationRevision: 1,
    },
  });
  return {
    messageId,
    publication,
    baseSnapshot: {
      rewriteId: publication.id,
      contentHash: publication.contentHash,
      title: "Min valgte og redigerte tittel",
      body: "Min redigerte ingress om avtalen.\n\nMitt andre avsnitt beholdes.",
    },
  };
}
async function request(messageId, body) {
  const response = await app.inject({
    method: "POST",
    url: `/notice/${messageId}/generate`,
    headers: { authorization: "Bearer fixture" },
    payload: body,
  });
  assert.ok([200, 202].includes(response.statusCode), response.body);
  return response.json();
}
async function state(runId) {
  return db.noticeGenerationControl.findUniqueOrThrow({
    where: { generationRunId: runId },
  });
}
async function published(runId) {
  return waitFor(async () => {
    const row = await state(runId);
    return row.status === "published" && row;
  }, `published ${runId}`);
}
before(async () => {
  await model.listen(0, "127.0.0.1");
  await new Promise((resolve) =>
    model.listening ? resolve() : model.once("listening", resolve),
  );
  client = new OpenAI({
    apiKey: "fixture-only",
    baseURL: `http://127.0.0.1:${model.address().port}/v1`,
    maxRetries: 0,
  });
  app = Fastify();
  app.decorate("authenticate", async (request, reply) => {
    if (request.headers.authorization !== "Bearer fixture")
      return reply.code(401).send({ message: "Unauthorized" });
  });
  app.decorate("config", {
    FAST_DRAFT_ENABLED: true,
    SESSION_SECRET: "isolated-fixture",
  });
  app.decorate("redis", connection);
  app.decorate("rewriteQueue", rewriteQueue);
  await app.register(noticeRoutes);
  await app.ready();
  startRuntime();
  startWorker();
  startPublisher();
  await waitFor(
    () => connection.get("newsweb:notice-editor-worker:v1"),
    "worker capability",
  );
});
after(async () => {
  await runtime.stop();
  await rewriteWorker.close();
  await publishWorker.close();
  await app.close();
  await rewriteQueue.obliterate({ force: true });
  await publishQueue.obliterate({ force: true });
  await rewriteQueue.close();
  await publishQueue.close();
  await connection.quit();
  model.closeAllConnections();
  await new Promise((resolve) => model.close(resolve));
  // Delete only rows explicitly created by this suite, in the guarded test DB.
  await db.generationRun.deleteMany({ where: { messageId: { in: notices } } });
  await db.sourceNotice.deleteMany({ where: { messageId: { in: notices } } });
  await Promise.all([
    db.$disconnect(),
    prisma.$disconnect(),
    logPrisma.$disconnect(),
  ]);
});
test("authenticated capabilities, displayed base ownership, URL failure and request-scoped status", async () => {
  const data = await seed();
  assert.equal(
    (await app.inject({ url: "/notice/editor-capabilities" })).statusCode,
    401,
  );
  const caps = await app.inject({
    url: "/notice/editor-capabilities",
    headers: { authorization: "Bearer fixture" },
  });
  assert.equal(caps.json().queuedGeneration, true);
  const other = await seed();
  const invalid = await app.inject({
    method: "POST",
    url: `/notice/${data.messageId}/generate`,
    headers: { authorization: "Bearer fixture" },
    payload: {
      clientRequestId: randomUUID(),
      baseSnapshot: other.baseSnapshot,
    },
  });
  assert.equal(invalid.statusCode, 409);
  const url = await app.inject({
    method: "POST",
    url: `/notice/${data.messageId}/materials/url`,
    headers: { authorization: "Bearer fixture" },
    payload: { url: "http://127.0.0.1/private" },
  });
  assert.equal(url.statusCode, 201);
  assert.equal(url.json().status, "failed");
  assert.equal(url.json().kind, "url");
  assert.equal(url.json().extractedTextChars, 0);
  const blocked = await app.inject({
    method: "POST",
    url: `/notice/${data.messageId}/generate`,
    headers: { authorization: "Bearer fixture" },
    payload: {
      clientRequestId: randomUUID(),
      baseSnapshot: data.baseSnapshot,
      selectedMaterialIds: [url.json().id],
    },
  });
  assert.equal(blocked.statusCode, 400);
});
test("FIFO queue, idempotency and frozen source/editor snapshots survive an active automatic run", async () => {
  const data = await seed();
  await db.feedItem.update({
    where: { messageId: data.messageId },
    data: { activeGenerationRunId: "automatic-fixture" },
  });
  const material = await db.noticeMaterial.create({
    data: {
      messageId: data.messageId,
      kind: "text",
      title: "Kilde",
      extractedText: "Originalt kildemateriale ved innsending.",
      status: "ready",
    },
  });
  const body = {
    clientRequestId: randomUUID(),
    baseSnapshot: data.baseSnapshot,
    instruction: "Behold valgt tekst",
    selectedMaterialIds: [material.id],
  };
  const [a, duplicate] = await Promise.all([
    request(data.messageId, body),
    request(data.messageId, body),
  ]);
  assert.equal(a.generationRunId, duplicate.generationRunId);
  const b = await request(data.messageId, {
    clientRequestId: randomUUID(),
    baseSnapshot: data.baseSnapshot,
    instruction: "Andre forespørsel",
  });
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal((await state(a.generationRunId)).targetVersion, null);
  assert.equal((await state(b.generationRunId)).targetVersion, null);
  await db.noticeMaterial.update({
    where: { id: material.id },
    data: { extractedText: "Dette ble endret senere." },
  });
  await db.feedItem.update({
    where: { messageId: data.messageId },
    data: { activeGenerationRunId: null },
  });
  const [first, second] = await Promise.all([
    published(a.generationRunId),
    published(b.generationRunId),
  ]);
  assert.equal(first.targetVersion, 2);
  assert.equal(second.targetVersion, 3);
  const executed = executions.find(
    (row) => row.generationRunId === a.generationRunId,
  );
  assert.equal(executed.previousRewriteJson.title, data.baseSnapshot.title);
  assert.equal(
    executed.previousRewriteJson.lead,
    "Min redigerte ingress om avtalen.",
  );
  assert.equal(
    executed.supplementalMaterials[0].text,
    "Originalt kildemateriale ved innsending.",
  );
  const status = await app.inject({
    url: `/notice/${data.messageId}/status?generationRunId=${a.generationRunId}`,
    headers: { authorization: "Bearer fixture" },
  });
  assert.equal(status.json().rewriteId, first.resultRewriteId);
  assert.notEqual(status.json().rewriteId, second.resultRewriteId);
  const changed = await app.inject({
    method: "POST",
    url: `/notice/${data.messageId}/generate`,
    headers: { authorization: "Bearer fixture" },
    payload: { ...body, instruction: "Different request" },
  });
  assert.equal(changed.statusCode, 409);
});
test("queued cancellation survives restart and never consumes a version", async () => {
  const data = await seed();
  await db.feedItem.update({
    where: { messageId: data.messageId },
    data: { activeGenerationRunId: "automatic-fixture" },
  });
  const row = await request(data.messageId, {
    clientRequestId: randomUUID(),
    baseSnapshot: data.baseSnapshot,
  });
  const cancelled = await app.inject({
    method: "POST",
    url: `/notice/${data.messageId}/generations/${row.generationRunId}/cancel`,
    headers: { authorization: "Bearer fixture" },
  });
  assert.equal(cancelled.json().state, "cancelled");
  await runtime.stop();
  startRuntime();
  await db.feedItem.update({
    where: { messageId: data.messageId },
    data: { activeGenerationRunId: null },
  });
  await runtime.tick();
  await new Promise((resolve) => setTimeout(resolve, 1200));
  assert.equal((await state(row.generationRunId)).targetVersion, null);
  assert.ok(
    !executions.some(
      (execution) => execution.generationRunId === row.generationRunId,
    ),
  );
});
test("active cancellation aborts the model call, cannot publish, and cannot release its successor", async () => {
  const data = await seed();
  const beforeAborts = aborted.length;
  const row = await request(data.messageId, {
    clientRequestId: randomUUID(),
    baseSnapshot: data.baseSnapshot,
    instruction: "SLOW",
  });
  await waitFor(
    () =>
      requests.some((value) =>
        JSON.stringify(value).includes(row.generationRunId),
      ),
    "model call started",
  );
  const next = await request(data.messageId, {
    clientRequestId: randomUUID(),
    baseSnapshot: data.baseSnapshot,
    instruction: "Etter avbrudd",
  });
  const cancel = await app.inject({
    method: "POST",
    url: `/notice/${data.messageId}/generations/${row.generationRunId}/cancel`,
    headers: { authorization: "Bearer fixture" },
  });
  assert.equal(cancel.json().state, "cancelling");
  await waitFor(
    async () => (await state(row.generationRunId)).status === "cancelled",
    "cancellation acknowledgement",
  );
  assert.ok(aborted.length > beforeAborts);
  assert.equal(
    await db.publishedRewrite.count({
      where: { generationRunId: row.generationRunId },
    }),
    0,
  );
  await published(next.generationRunId);
  await db.feedItem.update({
    where: { messageId: data.messageId },
    data: { activeGenerationRunId: "later-owner" },
  });
  await acknowledgeGenerationCancellation(db, row.generationRunId);
  assert.equal(
    (
      await db.feedItem.findUniqueOrThrow({
        where: { messageId: data.messageId },
      })
    ).activeGenerationRunId,
    "later-owner",
  );
  await db.feedItem.update({
    where: { messageId: data.messageId },
    data: { activeGenerationRunId: null },
  });
});
test("cancellation and publication have one atomic winner", async () => {
  for (let i = 0; i < 6; i++) {
    const data = await seed();
    const row = await createGenerationRequest(db, {
      messageId: data.messageId,
      clientRequestId: randomUUID(),
      snapshot: {},
    });
    const admitted = await admitGenerationRequest(db, row.generationRunId);
    assert.equal(admitted.kind, "admitted");
    await db.rewrite.create({
      data: {
        messageId: data.messageId,
        version: 2,
        generationRunId: row.generationRunId,
        lang: "nb",
        model: "fixture",
        promptVersion: "fixture",
        rewriteJson: original,
        validationJson: {},
        status: "pending",
      },
    });
    const publish = () =>
      finalizePublication(db, {
        messageId: data.messageId,
        version: 2,
        generationRunId: row.generationRunId,
      });
    const cancel = () =>
      cancelGenerationRequest(db, data.messageId, row.generationRunId);
    await Promise.all(i % 2 ? [publish(), cancel()] : [cancel(), publish()]);
    const result = await state(row.generationRunId);
    const count = await db.publishedRewrite.count({
      where: { generationRunId: row.generationRunId },
    });
    if (result.status === "published") assert.equal(count, 1);
    else {
      assert.equal(count, 0);
      assert.ok(["cancelling", "cancelled"].includes(result.status));
      await acknowledgeGenerationCancellation(db, row.generationRunId);
    }
    await db.feedItem.updateMany({
      where: {
        messageId: data.messageId,
        activeGenerationRunId: row.generationRunId,
      },
      data: { activeGenerationRunId: null },
    });
  }
});
test("admission interrupted before queue persistence recovers the same version and snapshot", async () => {
  await runtime.stop();
  const data = await seed();
  const row = await createGenerationRequest(db, {
    messageId: data.messageId,
    clientRequestId: randomUUID(),
    snapshot: {
      previousRewriteJson: { ...original, title: "Gjenopprettet valgt tittel" },
      instruction: "Gjenopprett",
      outputMode: "notice",
      maxVisibleArticleChars: 1000,
      supplementalMaterials: [],
    },
  });
  const admitted = await admitGenerationRequest(db, row.generationRunId);
  assert.equal(admitted.row.targetVersion, 2);
  assert.equal(
    await rewriteQueue.getJob(generationJobId(row.generationRunId)),
    undefined,
  );
  startRuntime();
  const result = await published(row.generationRunId);
  assert.equal(result.targetVersion, 2);
  assert.equal(
    executions.filter((value) => value.generationRunId === row.generationRunId)
      .length,
    1,
  );
});
test("failed generation retries from its frozen materials even after the source was removed", async () => {
  const data = await seed();
  const material = await db.noticeMaterial.create({
    data: {
      messageId: data.messageId,
      kind: "text",
      title: "Behold kilden",
      extractedText: "Kilden som fulgte den opprinnelige forespørselen.",
      status: "ready",
    },
  });
  failModels = true;
  const row = await request(data.messageId, {
    clientRequestId: randomUUID(),
    baseSnapshot: data.baseSnapshot,
    selectedMaterialIds: [material.id],
  });
  await waitFor(
    async () => (await state(row.generationRunId)).status === "failed",
    "terminal failure",
    20000,
  );
  failModels = false;
  await db.noticeMaterial.delete({ where: { id: material.id } });
  const retry = await request(data.messageId, {
    clientRequestId: randomUUID(),
    retryOf: row.generationRunId,
  });
  await published(retry.generationRunId);
  assert.equal(
    executions.find((value) => value.generationRunId === retry.generationRunId)
      .supplementalMaterials[0].text,
    "Kilden som fulgte den opprinnelige forespørselen.",
  );
});

test("candidate persisted before publication enqueue recovers without another model call", async () => {
  await runtime.stop();
  const data = await seed();
  const row = await createGenerationRequest(db, {
    messageId: data.messageId,
    clientRequestId: randomUUID(),
    snapshot: {},
  });
  const admitted = await admitGenerationRequest(db, row.generationRunId);
  assert.equal(admitted.kind, "admitted");
  await db.rewrite.create({
    data: {
      messageId: data.messageId,
      version: admitted.row.targetVersion,
      generationRunId: row.generationRunId,
      lang: "nb",
      model: "fixture",
      promptVersion: "fixture",
      rewriteJson: original,
      validationJson: {},
      status: "pending",
    },
  });
  startRuntime();
  const result = await published(row.generationRunId);
  assert.equal(result.targetVersion, 2);
  assert.equal(
    executions.filter((value) => value.generationRunId === row.generationRunId)
      .length,
    0,
  );
});
