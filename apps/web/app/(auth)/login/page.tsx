import { redirect } from "next/navigation";
import { LoginForm } from "./login-form";
import { getSessionToken } from "../../../lib/session";

type LoginPageProps = {
  searchParams: Promise<{
    token?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const sessionToken = await getSessionToken();
  if (sessionToken) {
    redirect("/feed");
  }

  const params = await searchParams;
  return <LoginForm token={params.token} />;
}
