import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, verificarTokenSessao } from "@/lib/auth";
import { getUsuarioPorId } from "@/lib/db";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default function LoginPage() {
  const token = cookies().get(SESSION_COOKIE_NAME)?.value;
  const uid = verificarTokenSessao(token);
  const usuario = uid ? getUsuarioPorId(uid) : undefined;

  if (usuario) {
    redirect("/");
  }

  return <LoginForm />;
}
