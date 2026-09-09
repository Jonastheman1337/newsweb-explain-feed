import { proxyToApi } from "../../../../lib/bff-proxy";
export async function GET(request:Request){return proxyToApi(request,"/notice/editor-capabilities");}
