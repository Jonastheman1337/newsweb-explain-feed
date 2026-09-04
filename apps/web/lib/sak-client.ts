"use client";

import type {
  SakCreateRequest,
  SakDraft,
  SakDraftResponse,
  SakGenerateRequest,
  SakGenerateResponse,
  SakListResponse,
  SakMaterial,
  SakStatusResponse
} from "@newsweb/shared";
import { getEditorId } from "./editorial-telemetry";

export class SakApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "SakApiError";
    this.status = status;
  }
}

function defaultMessage(status: number): string {
  switch (status) {
    case 401:
      return "Ikke innlogget.";
    case 404:
      return "Saken finnes ikke.";
    case 409:
      return "En generering pågår allerede.";
    case 413:
      return "Filen er for stor.";
    default:
      return "Noe gikk galt.";
  }
}

async function readErrorMessage(response: Response): Promise<string | null> {
  try {
    const data = (await response.json()) as { message?: unknown };
    return typeof data.message === "string" && data.message.trim()
      ? data.message
      : null;
  } catch {
    return null;
  }
}

/** Fetch `/api/sak<path>` with the per-browser owner header. */
export async function sakFetch<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  headers.set("x-sak-owner", getEditorId());

  const response = await fetch(`/api/sak${path}`, {
    ...init,
    headers,
    credentials: "include"
  });

  if (!response.ok) {
    const message = (await readErrorMessage(response)) ?? defaultMessage(response.status);
    throw new SakApiError(response.status, message);
  }

  if (response.status === 204) {
    return undefined as T;
  }
  return (await response.json()) as T;
}

function jsonInit(method: string, body: unknown, extra: RequestInit = {}): RequestInit {
  return {
    ...extra,
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  };
}

const id = (value: string) => encodeURIComponent(value);

export function listSak(): Promise<SakListResponse> {
  return sakFetch<SakListResponse>("");
}

export function createSak(body: SakCreateRequest = {}): Promise<SakDraft> {
  return sakFetch<SakDraft>("", jsonInit("POST", body));
}

export function getSak(sakId: string): Promise<SakDraftResponse> {
  return sakFetch<SakDraftResponse>(`/${id(sakId)}`);
}

export function deleteSak(sakId: string): Promise<{ ok: true }> {
  return sakFetch<{ ok: true }>(`/${id(sakId)}`, { method: "DELETE" });
}

export function generateSak(
  sakId: string,
  body: SakGenerateRequest
): Promise<SakGenerateResponse> {
  return sakFetch<SakGenerateResponse>(
    `/${id(sakId)}/generate`,
    jsonInit("POST", body, { keepalive: true })
  );
}

export function getSakStatus(
  sakId: string,
  query: { jobId?: string | null; version?: number | null } = {}
): Promise<SakStatusResponse> {
  const params = new URLSearchParams();
  if (query.jobId) params.set("jobId", query.jobId);
  if (query.version != null) params.set("version", String(query.version));
  const search = params.toString();
  return sakFetch<SakStatusResponse>(
    `/${id(sakId)}/status${search ? `?${search}` : ""}`
  );
}

export function addSakPdf(sakId: string, file: File): Promise<SakMaterial> {
  const formData = new FormData();
  formData.append("file", file);
  return sakFetch<SakMaterial>(`/${id(sakId)}/materials/pdf`, {
    method: "POST",
    body: formData
  });
}

export function addSakUrl(sakId: string, url: string): Promise<SakMaterial> {
  return sakFetch<SakMaterial>(`/${id(sakId)}/materials/url`, jsonInit("POST", { url }));
}

export function addSakText(
  sakId: string,
  body: { title?: string; text: string }
): Promise<SakMaterial> {
  return sakFetch<SakMaterial>(`/${id(sakId)}/materials/text`, jsonInit("POST", body));
}

export function patchSakMaterial(
  sakId: string,
  materialId: string,
  enabled: boolean
): Promise<SakMaterial> {
  return sakFetch<SakMaterial>(
    `/${id(sakId)}/materials/${id(materialId)}`,
    jsonInit("PATCH", { enabled })
  );
}

export function deleteSakMaterial(
  sakId: string,
  materialId: string
): Promise<{ ok: true }> {
  return sakFetch<{ ok: true }>(`/${id(sakId)}/materials/${id(materialId)}`, {
    method: "DELETE"
  });
}
