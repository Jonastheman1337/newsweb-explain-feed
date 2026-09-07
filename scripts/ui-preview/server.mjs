import http from "node:http";
import { randomUUID } from "node:crypto";
import { initialFixtures, fixtureItem } from "./fixtures.mjs";
import { feedResponseSchema, noticeResponseSchema } from "../../packages/shared/dist/api.js";

export function createFixtureServer() {
  let items = initialFixtures();
  let eventId = 0;
  const sessions = new Map();
  const streams = new Set();
  const timers = new Set();
  const json = (res, status, body) => {
    res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" });
    res.end(JSON.stringify(body));
  };
  const publish = (item) => {
    items = [item, ...items.filter((old) => old.messageId !== item.messageId)];
    const event = `id: ${++eventId}\ndata: ${JSON.stringify(item)}\n\n`;
    for (const stream of streams) stream.write(event);
  };
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
        return json(res, 200, { sessionToken, user: { id: "local-preview", username: "preview" } });
      }
      if (pathname === "/__preview/replay" && req.method === "POST") {
        const previous = items.find((item) => item.messageId === 900001);
        publish({ ...previous, regenerating: true });
        const timer = setTimeout(() => {
          timers.delete(timer);
          const version = previous.publicationRevision + 1;
          publish({
            ...previous,
            regenerating: false,
            rewriteVersion: version,
            publicationRevision: version,
            rewriteId: `fixture-900001-${version}`,
            contentHash: `fixture-900001-${version}`,
            title: "Nordvik inngår treårig vedlikeholdsavtale",
            body: [
              ...initialFixtures()[0].body,
              "Opsjonen er ikke med i den oppgitte kontraktsverdien."
            ]
          });
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
          categories: [{ id: 1, categoryNo: "Selskapsmeldinger", categoryEn: "Company notices" }],
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
            ready: item.isFinal,
            failed: item.failed,
            generatedAt: item.finalizedAt,
            version: item.rewriteVersion,
            jobState: item.regenerating ? "active" : null,
            generationRunId: null,
            phase: null,
            phaseUpdatedAt: null
          });
        if (
          ["event", "edit-log", "title-suggestion-log", "feedback"].includes(action) &&
          req.method === "POST"
        )
          return json(res, 200, { ok: true });
        if (action === "materials") return json(res, 200, { materials: [] });
        if (action === "generate" || action === "suggest-titles")
          return json(res, 409, { message: "Generering er av i lokal forhåndsvisning." });
        if (!action && item.isFinal) {
          const rewrite = {
            title: item.title,
            lead: item.lead,
            body: item.body,
            company_sentence: "",
            key_facts: item.keyFacts,
            negative_or_surprising: [],
            excluded_hype: [],
            source_limitations: [],
            confidence: item.confidence,
            importance: item.importance,
            source_spans: ["Fiktivt eksempel for lokal visning."]
          };
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
              rewrites: [
                {
                  rewriteId: item.rewriteId,
                  version: item.rewriteVersion,
                  rewrite,
                  userInstruction: null,
                  generatedAt: item.finalizedAt,
                  contentHash: item.contentHash,
                  isFinal: true
                }
              ]
            })
          );
        }
      }
      return json(res, 404, { message: "Ikke tilgjengelig i lokal forhåndsvisning." });
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
