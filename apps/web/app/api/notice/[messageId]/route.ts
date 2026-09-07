import { NextResponse } from "next/server";
import { proxyToApi } from "../../../../lib/bff-proxy";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const { messageId } = await params;
  if (!/^\d+$/.test(messageId))
    return NextResponse.json({ message: "Ugyldig melding." }, { status: 400 });
  return proxyToApi(request, `/notice/${messageId}`);
}
