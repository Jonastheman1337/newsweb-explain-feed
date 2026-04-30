export function getApiBaseUrl(): string {
  if (process.env.API_BASE_URL) {
    return process.env.API_BASE_URL;
  }

  if (process.env.API_HOSTPORT) {
    return `http://${process.env.API_HOSTPORT}`;
  }

  return process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:4000";
}
