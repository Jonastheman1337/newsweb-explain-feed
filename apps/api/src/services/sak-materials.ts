import {
  sakMaterialKindSchema,
  sakMaterialSourceId,
  sakMaterialStatusSchema,
  type SakMaterialSnapshot
} from "@newsweb/shared";
import { MATERIAL_TRUNCATION_MARKER } from "./notice-materials.js";

/**
 * Per-material and per-generation text budgets for /sak. A sak is written from
 * whole reports and several articles, so the caps are far above the notice
 * pipeline's (15k / 24k) but still bounded: the prompt is one call.
 */
export const SAK_MAX_MATERIAL_TEXT_CHARS = 60_000;
export const SAK_MAX_TOTAL_MATERIAL_TEXT_CHARS = 160_000;
export const SAK_MAX_TEXT_MATERIAL_INPUT_CHARS = 200_000;
export const SAK_MAX_URL_LENGTH = 2000;

export const SAK_TOTAL_TRUNCATION_MARKER = "[... mer valgt materiale er avkortet ...]";

// Below this many usable chars a material is dropped rather than truncated:
// a stub of a report only invites the model to guess the rest.
const MIN_TRUNCATED_MATERIAL_CHARS = 500;

export type SakMaterialCaps = {
  maxMaterialChars: number;
  maxTotalChars: number;
};

export const defaultSakMaterialCaps: SakMaterialCaps = {
  maxMaterialChars: SAK_MAX_MATERIAL_TEXT_CHARS,
  maxTotalChars: SAK_MAX_TOTAL_MATERIAL_TEXT_CHARS
};

export type SakMaterialRow = {
  id: string;
  kind: string;
  title: string;
  url: string | null;
  status: string;
  errorText: string | null;
  extractedText: string;
  enabled: boolean;
};

export type SakMaterialSnapshotSet = {
  snapshots: SakMaterialSnapshot[];
  included: string[];
  truncated: string[];
  dropped: string[];
};

function withMarker(text: string, keepChars: number, marker: string): string {
  return `${text.slice(0, keepChars).trimEnd()}\n\n${marker}`;
}

/**
 * Turns the enabled materials of a draft into the queue snapshot the worker
 * prompts from. Failed materials (paywalled URLs) ride along with empty text
 * so the model can link them as coverage; they cost no budget. Ready
 * materials are first capped per material, then fitted into the total
 * budget in creation order; whatever cannot get a meaningful share is
 * dropped and reported back to the caller.
 */
export function buildSakMaterialSnapshots(
  materials: SakMaterialRow[],
  caps: SakMaterialCaps = defaultSakMaterialCaps
): SakMaterialSnapshotSet {
  const snapshots: SakMaterialSnapshot[] = [];
  const included: string[] = [];
  const truncated: string[] = [];
  const dropped: string[] = [];
  let remainingChars = caps.maxTotalChars;

  for (const material of materials) {
    if (!material.enabled) continue;
    const kind = sakMaterialKindSchema.safeParse(material.kind);
    const status = sakMaterialStatusSchema.safeParse(material.status);
    if (!kind.success || !status.success) {
      dropped.push(material.id);
      continue;
    }

    if (status.data === "failed") {
      snapshots.push({
        id: material.id,
        sourceId: sakMaterialSourceId(material.id),
        kind: kind.data,
        title: material.title,
        url: material.url,
        status: "failed",
        errorText: material.errorText,
        text: "",
        textChars: 0
      });
      included.push(material.id);
      continue;
    }

    let text = material.extractedText.trim();
    if (!text) {
      dropped.push(material.id);
      continue;
    }

    let wasTruncated = false;
    if (text.length > caps.maxMaterialChars) {
      text = withMarker(
        text,
        caps.maxMaterialChars - MATERIAL_TRUNCATION_MARKER.length - 2,
        MATERIAL_TRUNCATION_MARKER
      );
      wasTruncated = true;
    }

    if (text.length > remainingChars) {
      const keepChars = remainingChars - SAK_TOTAL_TRUNCATION_MARKER.length - 2;
      if (keepChars < MIN_TRUNCATED_MATERIAL_CHARS) {
        dropped.push(material.id);
        continue;
      }
      text = withMarker(text, keepChars, SAK_TOTAL_TRUNCATION_MARKER);
      wasTruncated = true;
    }

    remainingChars -= text.length;
    snapshots.push({
      id: material.id,
      sourceId: sakMaterialSourceId(material.id),
      kind: kind.data,
      title: material.title,
      url: material.url,
      status: "ready",
      errorText: null,
      text,
      textChars: text.length
    });
    included.push(material.id);
    if (wasTruncated) truncated.push(material.id);
  }

  return { snapshots, included, truncated, dropped };
}

export function hasReadableSakMaterial(snapshots: SakMaterialSnapshot[]): boolean {
  return snapshots.some(
    (snapshot) => snapshot.status === "ready" && snapshot.text.trim().length > 0
  );
}
