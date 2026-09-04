import { proxyToApi } from "../../../../lib/bff-proxy";

type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, { params }: RouteContext) {
  const { id } = await params;
  return proxyToApi(request, `/sak/${encodeURIComponent(id)}`);
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const { id } = await params;
  return proxyToApi(request, `/sak/${encodeURIComponent(id)}`);
}
