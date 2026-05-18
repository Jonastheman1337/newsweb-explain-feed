import { getSignalsCsv, parseSignalsQuery } from "../../../../../lib/admin-signals";
import { getSessionToken } from "../../../../../lib/session";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const token = await getSessionToken();
  if (!token) {
    return Response.json({ message: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const query = parseSignalsQuery(Object.fromEntries(url.searchParams.entries()));
  const csv = await getSignalsCsv(query);
  const filename = `newsweb-signals-${query.tab}-${new Date().toISOString().slice(0, 10)}.csv`;

  return new Response(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`
    }
  });
}
