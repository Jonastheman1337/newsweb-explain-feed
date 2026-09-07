import http from "node:http";
import { randomUUID } from "node:crypto";
import { initialFixtures, fixtureItem } from "./fixtures.mjs";
import { feedResponseSchema, noticeResponseSchema } from "../../packages/shared/dist/api.js";

export function createFixtureServer() {
  let items = initialFixtures();
  let eventId = 0;
  const history = new Map(
    items.filter((item) => item.isFinal).map((item) => [item.messageId, [item]])
  );
  const jobs = new Map();
  const instructions = new Map();
  function rewriteFor(item) {
    return {
      title: item.title,
      lead: item.lead,
      body: item.body,
      company_sentence: "",
      key_facts: item.keyFacts,
      negative_or_surprising: item.negativeOrSurprising,
      excluded_hype: [],
      source_limitations: item.sourceLimitations,
      confidence: item.confidence,
      importance: item.importance,
      source_spans: ["Fiktivt eksempel for lokal visning."]
    };
  }
  const sessions = new Map();
  const streams = new Set();
  const timers = new Set();
  const json = (res, status, body) => {
    res.writeHead(status, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    });
    res.end(JSON.stringify(body));
  };
  const publish = (item) => {
    items = [item, ...items.filter((old) => old.messageId !== item.messageId)];
    if (item.isFinal && !item.regenerating && item.rewriteId) {
      const versions = history.get(item.messageId) ?? [];
      if (!versions.some((version) => version.rewriteId === item.rewriteId))
        history.set(item.messageId, [...versions, item]);
    }
    const event = `id: ${++eventId}\ndata: ${JSON.stringify(item)}\n\n`;
    for (const stream of streams) stream.write(event);
  };
  function queueGeneration(previous, instruction = "", fail = false) {
    const activeJob = jobs.get(previous.messageId);
    if (activeJob) return activeJob;
    const jobId = "fixture-job-" + randomUUID();
    jobs.set(previous.messageId, jobId);
    publish({
      ...previous,
      failed: false,
      skipped: false,
      processing: !previous.isFinal,
      regenerating: previous.isFinal,
      phase: "writing_notice"
    });
    const timer = setTimeout(() => {
      timers.delete(timer);
      jobs.delete(previous.messageId);
      if (fail) {
        publish({
          ...previous,
          failed: true,
          processing: false,
          regenerating: false,
          phase: "failed"
        });
        return;
      }
      const version = (previous.rewriteVersion ?? 0) + 1;
      const original =
        initialFixtures().find((item) => item.messageId === previous.messageId) ?? previous;
      const item = {
        ...previous,
        isFinal: true,
        notGenerated: false,
        failed: false,
        skipped: false,
        processing: false,
        regenerating: false,
        phase: "published",
        rewriteVersion: version,
        publicationRevision: previous.publicationRevision + 1,
        rewriteId: "fixture-" + previous.messageId + "-" + version,
        contentHash: "fixture-" + previous.messageId + "-" + version,
        finalizedAt: new Date().toISOString(),
        title:
          previous.messageId === 900001
            ? "Nordvik inngår treårig vedlikeholdsavtale"
            : original.title,
        lead: original.lead || original.sourceBodyText,
        body:
          previous.messageId === 900001
            ? [...original.body, "Opsjonen er ikke med i den oppgitte kontraktsverdien."]
            : original.body
      };
      instructions.set(item.rewriteId, instruction || null);
      publish(item);
    }, 1500);
    timers.add(timer);
    return jobId;
  }
  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, "http://127.0.0.1");
      const pathname = url.pathname;
      // A dedicated loopback-only process. Never accept cross-origin mutations.
      if (
        req.method !== "GET" &&
        req.headers.origin &&
        !["http://127.0.0.1:3101", "http://localhost:3101"].includes(req.headers.origin)
      )
        return json(res, 403, { message: "Origin rejected" });
      const chunks = [];
      let size = 0;
      for await (const chunk of req) {
        size += chunk.length;
        if (size > 1000000) return json(res, 413, { message: "Too large" });
        chunks.push(chunk);
      }
      const raw = Buffer.concat(chunks).toString();
      const body = raw ? JSON.parse(raw) : {};
      if (pathname === "/auth/login" && req.method === "POST") {
        if (body.username !== "preview" || body.password !== "ui-preview")
          return json(res, 401, { message: "Innlogging feilet" });
        const sessionToken = randomUUID();
        sessions.set(sessionToken, []);
        return json(res, 200, {
          sessionToken,
          user: { id: "local-preview", username: "preview" }
        });
      }
      if (pathname === "/__preview/replay" && req.method === "POST") {
        const previous = items.find((item) => item.messageId === 900001);
        queueGeneration(previous, "", body.fail === true);
        const timer = setTimeout(() => {
          timers.delete(timer);
          const version = (previous.rewriteVersion ?? 0) + 1;
          publish(
            fixtureItem(
              900010 + version,
              "Vestby Teknologi",
              "Vestby Teknologi kjøper programvareselskap",
              "Vestby Teknologi kjøper alle aksjene i et norsk programvareselskap, ifølge en børsmelding.",
              ["Oppkjøpet ventes gjennomført i fjerde kvartal."],
              { publishedAt: "2026-09-07T08:00:00.000Z" }
            )
          );
        }, 1500);
        timers.add(timer);
        return json(res, 202, { ok: true });
      }
      const token = req.headers.authorization?.replace(/^Bearer /, "");
      if (!sessions.has(token)) return json(res, 401, { message: "Logg inn" });
      if (pathname === "/feed/stream") {
        res.writeHead(200, {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          Connection: "keep-alive"
        });
        res.write('event: control\ndata: {"type":"reset"}\n\n');
        streams.add(res);
        const timer = setInterval(() => res.write(": heartbeat\n\n"), 15000);
        res.on("close", () => {
          clearInterval(timer);
          streams.delete(res);
        });
        return;
      }
      if (pathname === "/feed") {
        const p = url.searchParams;
        let filtered = [...items].sort(
          (a, b) => b.publishedAt.localeCompare(a.publishedAt) || b.messageId - a.messageId
        );
        if (p.get("q"))
          filtered = filtered.filter((item) =>
            `${item.title} ${item.lead} ${item.body.join(" ")} ${item.issuerName}`
              .toLowerCase()
              .includes(p.get("q").toLowerCase())
          );
        if (p.get("issuer"))
          filtered = filtered.filter((item) => item.issuerSign === p.get("issuer"));
        if (p.get("category"))
          filtered = filtered.filter((item) => item.categories.includes(p.get("category")));
        if (p.get("market") && p.get("market") !== "OSE") filtered = [];
        if (p.get("cursor"))
          filtered = filtered.filter(
            (item) =>
              item.publishedAt < p.get("cursor") ||
              (item.publishedAt === p.get("cursor") && item.messageId < Number(p.get("cursorId")))
          );
        const limit = Math.min(60, Math.max(1, Number(p.get("limit")) || 30));
        const page = filtered.slice(0, limit);
        const last = filtered.length > limit ? page.at(-1) : null;
        return json(
          res,
          200,
          feedResponseSchema.parse({
            items: page,
            nextCursor: last?.publishedAt ?? null,
            nextCursorId: last?.messageId ?? null
          })
        );
      }
      if (pathname === "/meta/filters")
        return json(res, 200, {
          markets: [{ id: 1, symbol: "OSE", name: "Oslo Børs" }],
          categories: [
            {
              id: 1,
              categoryNo: "Selskapsmeldinger",
              categoryEn: "Company notices"
            }
          ],
          issuers: items.map((item) => ({
            issuerId: item.messageId,
            symbol: item.issuerSign,
            name: item.issuerName
          }))
        });
      if (pathname === "/settings/muted-categories") {
        if (req.method === "PUT")
          sessions.set(token, Array.isArray(body.mutedCategories) ? body.mutedCategories : []);
        return json(res, 200, { mutedCategories: sessions.get(token) });
      }
      const match = pathname.match(/^\/notice\/(\d+)(?:\/(.*))?$/);
      if (match) {
        const item = items.find((item) => item.messageId === Number(match[1]));
        if (!item) return json(res, 404, { message: "Not found" });
        const action = match[2];
        if (action === "status")
          return json(res, 200, {
            ready: item.isFinal && !jobs.has(item.messageId),
            failed: item.failed,
            generatedAt: item.finalizedAt,
            version: item.rewriteVersion,
            jobState: jobs.has(item.messageId) ? "active" : null,
            generationRunId: null,
            phase: item.phase ?? null,
            phaseUpdatedAt: null
          });
        if (
          ["event", "edit-log", "title-suggestion-log", "feedback"].includes(action) &&
          req.method === "POST"
        )
          return json(res, 200, { ok: true });
        if (action === "materials") return json(res, 200, { materials: [] });
        if (action === "generate" && req.method === "POST")
          return json(res, 200, {
            jobId: queueGeneration(
              item,
              typeof body.instruction === "string" ? body.instruction : ""
            ),
            version: item.rewriteVersion
          });
        if (action === "suggest-titles" && req.method === "POST") {
          const examples =
            item.messageId === 900001
              ? [
                  "Nordvik sikrer treårig avtale",
                  "Vedlikeholdsavtale verdt 420 millioner for Nordvik",
                  "Nordvik får ny kontrakt i Nordsjøen"
                ]
              : item.messageId === 900002
                ? [
                    "Fjord Seafood slaktet mer laks i august",
                    "Økt slaktevolum for Fjord Seafood",
                    "Fjord Seafood slaktet 18.400 tonn laks"
                  ]
                : [item.title, item.issuerName + " melder om endringer"];
          return json(res, 200, { titles: examples });
        }
        if (!action && !item.isFinal)
          return json(res, 200, {
            source: {
              ...item,
              title: item.sourceTitle,
              bodyText: item.sourceBodyText,
              markets: ["OSE"]
            },
            ...(item.processing
              ? { processing: true }
              : item.failed
                ? { failed: true }
                : { skipped: true })
          });
        if (!action && item.isFinal) {
          const rewrite = rewriteFor(item);
          return json(
            res,
            200,
            noticeResponseSchema.parse({
              source: {
                ...item,
                title: item.sourceTitle,
                bodyText: item.sourceBodyText,
                markets: ["OSE"]
              },
              rewrite,
              publication: {
                rewriteId: item.rewriteId,
                version: item.rewriteVersion,
                revision: item.publicationRevision,
                contentHash: item.contentHash,
                finalizedAt: item.finalizedAt,
                isFinal: true
              },
              rewrites: (history.get(item.messageId) ?? []).map((version) => ({
                rewriteId: version.rewriteId,
                version: version.rewriteVersion,
                rewrite: rewriteFor(version),
                userInstruction: instructions.get(version.rewriteId) ?? null,
                generatedAt: version.finalizedAt,
                contentHash: version.contentHash,
                isFinal: true
              }))
            })
          );
        }
      }
      return json(res, 404, {
        message: "Ikke tilgjengelig i lokal forhåndsvisning."
      });
    } catch (error) {
      console.error("Fixture request failed:", error.message);
      if (!res.headersSent) json(res, 400, { message: "Invalid fixture request" });
      else res.end();
    }
  });
  return {
    server,
    async listen(port = 4101) {
      await new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", resolve);
      });
      return server.address().port;
    },
    async close() {
      for (const timer of timers) clearTimeout(timer);
      for (const stream of streams) stream.end();
      await new Promise((resolve) => server.close(resolve));
    }
  };
}
