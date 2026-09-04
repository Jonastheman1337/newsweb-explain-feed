import { proxyToApi } from "../../../../../../lib/bff-proxy";

type RouteContext = { params: Promise<{ id: string; materialId: string }> };

function upstreamPath(id: string, materialId: string): string {
  return `/sak/${encodeURIComponent(id)}/materials/${encodeURIComponent(materialId)}`;
}

export async function PATCH(request: Request, { params }: RouteContext) {
  const { id, materialId } = await params;
  return proxyToApi(request, upstreamPath(id, materialId));
}

export async function DELETE(request: Request, { params }: RouteContext) {
  const { id, materialId } = await params;
  return proxyToApi(request, upstreamPath(id, materialId));
}
