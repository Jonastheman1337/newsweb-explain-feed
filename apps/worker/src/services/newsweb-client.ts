import {
  newswebListMessageSchema,
  newswebListResponseSchema,
  newswebMessageResponseSchema,
  newswebMessageSchema
} from "@newsweb/shared";
import type { z } from "zod";

export const NEWSWEB_LIST_URL = "https://api3.oslo.oslobors.no/v1/newsreader/list";
export const NEWSWEB_MESSAGE_URL =
  "https://api3.oslo.oslobors.no/v1/newsreader/message";

export type NewswebListMessage = z.infer<typeof newswebListMessageSchema>;
export type NewswebMessage = z.infer<typeof newswebMessageSchema>;

export type NewswebMessageDetails = {
  message: NewswebMessage;
  bodyText: string;
  hasAttachments: boolean;
  // The raw (unparsed) message so fields the zod schema strips — attachment
  // names, correctionForMessageId — survive into source_notices.raw_message_json.
  rawMessageJson: unknown;
};

function formatIsoDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function buildNewswebListUrl(daysBack = 0): string {
  if (daysBack <= 0) return NEWSWEB_LIST_URL;
  const today = new Date();
  const fromDate = new Date(today);
  fromDate.setDate(fromDate.getDate() - daysBack);
  return buildNewswebListUrlForRange(formatIsoDate(fromDate), formatIsoDate(today));
}

/** `fromDate`/`toDate` are calendar dates (YYYY-MM-DD), inclusive. */
export function buildNewswebListUrlForRange(fromDate: string, toDate: string): string {
  return `${NEWSWEB_LIST_URL}?fromDate=${fromDate}&toDate=${toDate}`;
}

export async function fetchNewswebListMessages(
  url: string,
  fetchImpl: typeof fetch = fetch
): Promise<NewswebListMessage[]> {
  const response = await fetchImpl(url);
  if (!response.ok) {
    throw new Error(`Newsweb list failed: ${response.status}`);
  }
  const json = await response.json();
  return newswebListResponseSchema.parse(json).data.messages;
}

export async function fetchNewswebMessage(
  messageId: number,
  fetchImpl: typeof fetch = fetch
): Promise<NewswebMessageDetails> {
  const response = await fetchImpl(`${NEWSWEB_MESSAGE_URL}?messageId=${messageId}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    }
  });
  if (!response.ok) {
    throw new Error(`Newsweb message ${messageId} failed: ${response.status}`);
  }
  const json = await response.json();
  const parsed = newswebMessageResponseSchema.parse(json);
  const rawMessage = (json as Record<string, unknown>).data as
    | Record<string, unknown>
    | undefined;
  return {
    message: parsed.data.message,
    bodyText: parsed.data.message.body ?? "",
    hasAttachments: parsed.data.message.attachments.length > 0,
    rawMessageJson: rawMessage?.message ?? parsed.data.message
  };
}
