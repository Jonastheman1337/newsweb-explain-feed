import { proxyToApi } from "../../../lib/bff-proxy";

export async function GET(request: Request) {
  return proxyToApi(request, "/sak");
}

export async function POST(request: Request) {
  return proxyToApi(request, "/sak");
}
