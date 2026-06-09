import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getApiBaseUrl } from "../../../../../../lib/api-base-url";
import { SESSION_COOKIE } from "../../../../../../lib/session-cookie";

const API_BASE_URL = getApiBaseUrl();

async function headers(contentType?: string): Promise<Record<string, string>> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  return {
    ...(contentType ? { "Content-Type": contentType } : {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {})
  };
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ messageId: string; materialId: string }> }
) {
  const { messageId, materialId } = await params;
  const response = await fetch(
    `${API_BASE_URL}/notice/${messageId}/materials/${materialId}`,
    {
      method: "PATCH",
      headers: await headers("application/json"),
      body: JSON.stringify(await request.json())
    }
  );

  return NextResponse.json(await response.json(), { status: response.status });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ messageId: string; materialId: string }> }
) {
  const { messageId, materialId } = await params;
  const response = await fetch(
    `${API_BASE_URL}/notice/${messageId}/materials/${materialId}`,
    {
      method: "DELETE",
      headers: await headers()
    }
  );

  return NextResponse.json(await response.json(), { status: response.status });
}
