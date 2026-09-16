import { proxyToApi } from "../../../../../../lib/bff-proxy";
export async function POST(request: Request, {params}: {params: Promise<{messageId:string}>}) {
  const {messageId}=await params;
  return proxyToApi(request, `/notice/${encodeURIComponent(messageId)}/materials/pdf`);
}
