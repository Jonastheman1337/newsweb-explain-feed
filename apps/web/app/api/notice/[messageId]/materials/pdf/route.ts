import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getApiBaseUrl } from "../../../../../../lib/api-base-url";
import { SESSION_COOKIE } from "../../../../../../lib/session-cookie";

const API_BASE_URL = getApiBaseUrl();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ messageId: string }> }
) {
  const { messageId } = await params;
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  const headers: Record<string, string> = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  const response = await fetch(
    `${API_BASE_URL}/notice/${messageId}/materials/pdf`,
    {
      method: "POST",
      headers,
      body: (await request.formData()) as unknown as BodyInit
    }
  );

  return NextResponse.json(await response.json(), { status: response.status });
}
