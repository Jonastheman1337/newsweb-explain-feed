import { proxyToApi } from "../../../../../../../lib/bff-proxy";
export async function POST(request:Request,{params}:{params:Promise<{messageId:string;generationRunId:string}>}){
 const {messageId,generationRunId}=await params;
 return proxyToApi(request,`/notice/${encodeURIComponent(messageId)}/generations/${encodeURIComponent(generationRunId)}/cancel`);
}
