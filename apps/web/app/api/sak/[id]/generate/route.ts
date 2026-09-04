import { proxyToApi } from "../../../../../lib/bff-proxy";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  return proxyToApi(request, `/sak/${encodeURIComponent(id)}/generate`);
}
