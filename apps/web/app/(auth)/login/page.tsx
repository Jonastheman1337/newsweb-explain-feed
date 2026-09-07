import { LoginForm } from "./login-form";
import { loginDestination } from "../../../lib/ui-features";

type LoginPageProps = {
  searchParams: Promise<{
    token?: string;
    next?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  return (
    <main className="loginWrap">
      <LoginForm token={params.token} returnTo={loginDestination(params.next)} />
    </main>
  );
}
