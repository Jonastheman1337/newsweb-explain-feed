import { redirect } from "next/navigation";
import { SakDraft } from "../../../../components/sak-draft";
import { getSessionToken } from "../../../../lib/session";

type SakDraftPageProps = {
  params: Promise<{ id: string }>;
};

export default async function SakDraftPage({ params }: SakDraftPageProps) {
  const token = await getSessionToken();
  if (!token) {
    redirect("/login");
  }

  const { id } = await params;
  return <SakDraft id={id} />;
}
