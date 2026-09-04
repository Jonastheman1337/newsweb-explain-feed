import { redirect } from "next/navigation";
import { SakList } from "../../../components/sak-list";
import { getSessionToken } from "../../../lib/session";

type SakPageProps = {
  searchParams: Promise<{ gone?: string }>;
};

// Hidden page: reachable only by URL, never linked from the UI. Drafts are
// scoped to the browser (localStorage editor id), so data loads client-side.
export default async function SakPage({ searchParams }: SakPageProps) {
  const token = await getSessionToken();
  if (!token) {
    redirect("/login");
  }

  const { gone } = await searchParams;
  return <SakList gone={gone === "1"} />;
}
