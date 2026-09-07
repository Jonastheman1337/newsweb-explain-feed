import { NextResponse } from "next/server";
import { proxyToApi } from "../../../../lib/bff-proxy";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const { messageId } = await params;
  if (!/^\d+$/.test(messageId))
    return NextResponse.json({ message: "Ugyldig melding." }, { status: 400 });
  const variant = process.env.UI_V2_ENABLED === "true" && new URL(request.url).searchParams.get("ui") === "v2" ? "?ui=v2" : "";
  return proxyToApi(request, `/notice/${messageId}${variant}`);
}
