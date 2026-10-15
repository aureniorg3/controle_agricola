import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { SESSION_COOKIE_NAME, verificarTokenSessao } from "@/lib/auth";
import { getUsuarioPorId } from "@/lib/db";
import { paginaInicial } from "@/lib/menu";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  const uid = verificarTokenSessao(token);
  const usuario = uid ? await getUsuarioPorId(uid) : undefined;

  // inativo com o cookie ainda válido vê o formulário (o layout o mandaria de volta para cá, em círculo)
  if (usuario?.ativo) {
    // já entrou: a página inicial dele (o Início ou a primeira tela liberada; sem nenhuma, "/" mostra o aviso)
    redirect(usuario.precisaTrocarSenha ? "/trocar-senha" : (paginaInicial(usuario.perfil, usuario.acessos) ?? "/"));
  }

  return <LoginForm />;
}
