import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Prisma } from "@prisma/client";
import { logPrisma } from "@newsweb/shared/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getApiBaseUrl } from "../../../../../lib/api-base-url";
import { SESSION_COOKIE } from "../../../../../lib/session-cookie";

const API_BASE_URL = getApiBaseUrl();

export const runtime = "nodejs";

// Load env vars from monorepo root .env if not already in process.env
let _envCache: Record<string, string> | null = null;
function loadEnvVar(name: string, fallback: string): string {
  if (process.env[name]) return process.env[name]!;
  if (!_envCache) {
    _envCache = {};
    // Try multiple possible locations for the .env file
    const candidates = [
      resolve(process.cwd(), ".env"),
      resolve(process.cwd(), "../../.env"),           // from apps/web
      resolve(process.cwd(), "../../../.env"),         // deeper nesting
    ];
    for (const candidate of candidates) {
      try {
        const envFile = readFileSync(candidate, "utf-8");
        for (const line of envFile.split("\n")) {
          const m = line.match(/^([A-Z_]+)="?([^"]*)"?\s*$/);
          if (m) _envCache[m[1]] = m[2];
        }
        break;
      } catch { /* try next */ }
    }
  }
  return _envCache[name] ?? fallback;
}

function toJsonValue(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value ?? null)) as Prisma.InputJsonValue;
}

async function updateGenerationRunFailure(runId: string | null, errorText: string) {
  if (!runId) return;
  try {
    await logPrisma.generationRun.update({
      where: { id: runId },
      data: {
        status: "failed",
        errorText,
        finishedAt: new Date()
      }
    });
  } catch (error) {
    console.error("[suggest-titles] failed to update generation log:", error);
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const { messageId } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;

  const ANTHROPIC_API_KEY = loadEnvVar("ANTHROPIC_API_KEY", "");
  const ANTHROPIC_MODEL = loadEnvVar("ANTHROPIC_MODEL", "claude-sonnet-4-6");

  if (!ANTHROPIC_API_KEY) {
    return NextResponse.json({ message: "API key not configured" }, { status: 500 });
  }

  // Fetch the notice to get context — pass auth token if available
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  const noticeRes = await fetch(`${API_BASE_URL}/notice/${messageId}`, { headers });
  if (!noticeRes.ok) {
    return NextResponse.json({ message: "Notice not found" }, { status: 404 });
  }
  const notice = await noticeRes.json();

  const currentTitle = notice.rewrite?.title ?? notice.source?.title ?? "";
  const lead = notice.rewrite?.lead ?? "";
  const body = notice.rewrite?.body?.join("\n") ?? "";
  const issuerName = notice.source?.issuerName ?? "";

  const prompt = [
    "Du er en erfaren nyhetsredaktør som skriver titler i E24-stil.",
    "Lag 5 alternative titler for nyhetssaken under.",
    "Regler:",
    "- Maks 8 ord per tittel.",
    "- Kort, stram og slagkraftig.",
    "- Bruk selskapsnavn, ikke ticker-koder.",
    "- Hvert forslag skal ha en ulik vinkling eller fokus.",
    "- Skriv ut 'millioner' og 'milliarder' med mindre tittelen blir for lang.",
    "- Norsk bokmål med korrekte tegn (æ, ø, å).",
    "- Returner KUN en JSON-array med 5 strenger, ingenting annet.",
    "",
    `Selskap: ${issuerName}`,
    `Nåværende tittel: ${currentTitle}`,
    `Lead: ${lead}`,
    `Brødtekst: ${body}`
  ].join("\n");

  let generationRunId: string | null = null;
  const numericMessageId = Number(messageId);
  const requestPayload = {
    endpoint: "POST /api/notice/[messageId]/suggest-titles",
    messageId: numericMessageId,
    currentTitle,
    lead,
    body,
    issuerName,
    model: ANTHROPIC_MODEL,
    prompt
  };

  try {
    const generationRun = await logPrisma.generationRun.create({
      data: {
        messageId: numericMessageId,
        reason: "title-suggestion",
        status: "started",
        inputJson: toJsonValue(requestPayload),
        model: ANTHROPIC_MODEL,
        promptVersion: "title-suggestions-v1",
        promptChars: prompt.length,
        startedAt: new Date()
      }
    });
    generationRunId = generationRun.id;

    try {
      await logPrisma.userActionEvent.create({
        data: {
          messageId: numericMessageId,
          action: "title_suggestion_generation_request",
          payloadJson: toJsonValue({
            generationRunId,
            currentTitle,
            issuerName
          })
        }
      });
    } catch (error) {
      console.error("[suggest-titles] failed to write action event:", error);
    }
  } catch (error) {
    console.error("[suggest-titles] failed to create generation log:", error);
    return NextResponse.json({ message: "Logging failed" }, { status: 500 });
  }

  try {
    const anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      signal: AbortSignal.timeout(15000),
      headers: {
        "content-type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 512,
        temperature: 1,
        messages: [
          { role: "user", content: prompt }
        ]
      })
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      console.error("[suggest-titles] Anthropic error:", errText);
      await updateGenerationRunFailure(generationRunId, errText);
      return NextResponse.json({ message: "AI request failed" }, { status: 502 });
    }

    const result = await anthropicRes.json();
    const text = result.content?.[0]?.text ?? "[]";

    // Extract JSON array from response
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) {
      await logPrisma.generationRun.update({
        where: { id: generationRunId! },
        data: {
          status: "finished",
          outputJson: toJsonValue({ rawText: text, titles: [] }),
          finishedAt: new Date()
        }
      });
      return NextResponse.json({ titles: [] });
    }

    const titles: string[] = JSON.parse(match[0]);
    const selectedTitles = titles.slice(0, 5);
    await logPrisma.generationRun.update({
      where: { id: generationRunId! },
      data: {
        status: "finished",
        outputJson: toJsonValue({ rawText: text, titles: selectedTitles }),
        finishedAt: new Date()
      }
    });
    return NextResponse.json({ titles: selectedTitles });
  } catch (err) {
    console.error("[suggest-titles] Error:", err);
    await updateGenerationRunFailure(
      generationRunId,
      err instanceof Error ? err.message : String(err)
    );
    return NextResponse.json({ message: "Failed to generate titles" }, { status: 500 });
  }
}
