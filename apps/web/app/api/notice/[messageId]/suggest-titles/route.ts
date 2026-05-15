import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Prisma } from "@prisma/client";
import { logPrisma } from "@newsweb/shared/db";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import OpenAI from "openai";
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

const titleSuggestionsJsonSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    titles: {
      type: "array",
      minItems: 5,
      maxItems: 5,
      items: {
        type: "string",
        minLength: 3,
        maxLength: 120
      }
    }
  },
  required: ["titles"]
} as const;

function parseTitleSuggestions(raw: string): string[] {
  const parsed = JSON.parse(raw) as { titles?: unknown };
  if (!Array.isArray(parsed.titles)) return [];
  return parsed.titles
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 5);
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
  let requestBody: {
    currentTitle?: unknown;
    telemetry?: unknown;
  } = {};
  try {
    requestBody = await request.json();
  } catch {
    requestBody = {};
  }

  const OPENAI_API_KEY = loadEnvVar("OPENAI_API_KEY", "");
  const OPENAI_FAST_MODEL = loadEnvVar("OPENAI_FAST_MODEL", "gpt-5.4-mini");
  const OPENAI_FAST_TIMEOUT_MS = Number(
    loadEnvVar("OPENAI_FAST_TIMEOUT_MS", "15000")
  );

  if (!OPENAI_API_KEY) {
    return NextResponse.json({ message: "OpenAI is not configured" }, { status: 500 });
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

  const requestedCurrentTitle =
    typeof requestBody.currentTitle === "string"
      ? requestBody.currentTitle.trim()
      : "";
  const currentTitle =
    requestedCurrentTitle || notice.rewrite?.title || notice.source?.title || "";
  const lead = notice.rewrite?.lead ?? "";
  const body = notice.rewrite?.body?.join("\n") ?? "";
  const issuerName = notice.source?.issuerName ?? "";

  const developerPrompt = [
    "Du er en erfaren nyhetsredaktør som skriver titler i E24-stil.",
    "Lag 5 alternative titler for nyhetssaken under.",
    "Regler:",
    "- Maks 8 ord per tittel.",
    "- Kort, stram og slagkraftig.",
    "- Bruk selskapsnavn, ikke ticker-koder.",
    "- Hvert forslag skal ha en ulik vinkling eller fokus.",
    "- Skriv ut 'millioner' og 'milliarder' med mindre tittelen blir for lang.",
    "- Norsk bokmål med korrekte tegn (æ, ø, å).",
    "- Returner fem titler i det strukturerte skjemaet."
  ].join("\n");
  const userPrompt = [
    `Selskap: ${issuerName}`,
    `Nåværende tittel: ${currentTitle}`,
    `Lead: ${lead}`,
    `Brødtekst: ${body}`
  ].join("\n");

  const prompt = [developerPrompt, "", userPrompt].join("\n");

  let generationRunId: string | null = null;
  const numericMessageId = Number(messageId);
  const requestPayload = {
    endpoint: "POST /api/notice/[messageId]/suggest-titles",
    messageId: numericMessageId,
    currentTitle,
    lead,
    body,
    issuerName,
    model: OPENAI_FAST_MODEL,
    reasoningEffort: "none",
    prompt
  };

  try {
    const generationRun = await logPrisma.generationRun.create({
      data: {
        messageId: numericMessageId,
        reason: "title-suggestion",
        status: "started",
        inputJson: toJsonValue(requestPayload),
        model: OPENAI_FAST_MODEL,
        promptVersion: "title-suggestions-v2",
        promptChars: prompt.length,
        startedAt: new Date()
      }
    });
    generationRunId = generationRun.id;

    try {
      await fetch(`${API_BASE_URL}/notice/${messageId}/event`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          action: "title_suggestion_generation_request",
          telemetry: requestBody.telemetry,
          payload: {
            generationRunId,
            currentTitle,
            issuerName
          }
        })
      });
    } catch (error) {
      console.error("[suggest-titles] failed to write action event:", error);
    }
  } catch (error) {
    console.error("[suggest-titles] failed to create generation log:", error);
    return NextResponse.json({ message: "Logging failed" }, { status: 500 });
  }

  try {
    const openAI = new OpenAI({ apiKey: OPENAI_API_KEY });
    const response = await openAI.responses.create(
      {
        model: OPENAI_FAST_MODEL,
        max_output_tokens: 512,
        store: false,
        reasoning: { effort: "none" },
        input: [
          { role: "developer", content: developerPrompt },
          { role: "user", content: userPrompt }
        ],
        text: {
          format: {
            type: "json_schema",
            name: "title_suggestions",
            schema: titleSuggestionsJsonSchema,
            strict: true
          },
          verbosity: "low"
        }
      },
      {
        signal: AbortSignal.timeout(
          Number.isFinite(OPENAI_FAST_TIMEOUT_MS)
            ? OPENAI_FAST_TIMEOUT_MS
            : 15000
        )
      }
    );
    const text = response.output_text?.trim() ?? "";
    if (!text) {
      throw new Error("OpenAI returned no title suggestion output");
    }

    const selectedTitles = parseTitleSuggestions(text);
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
