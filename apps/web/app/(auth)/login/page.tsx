import { LoginForm } from "./login-form";

type LoginPageProps = {
  searchParams: Promise<{
    token?: string;
  }>;
};

export default async function LoginPage({ searchParams }: LoginPageProps) {
  const params = await searchParams;
  return (
    <main className="loginWrap">
      <LoginForm token={params.token} />
    </main>
  );
}
