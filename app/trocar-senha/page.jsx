import { redirect } from "next/navigation";
import { usuarioAtual } from "@/lib/db";
import { paginaInicial } from "@/lib/menu";
import TrocarSenhaForm from "./TrocarSenhaForm";

export const dynamic = "force-dynamic";

export default async function TrocarSenhaPage() {
  const usuario = await usuarioAtual();

  if (!usuario) {
    redirect("/login");
  }
  if (!usuario.precisaTrocarSenha) {
    // a página inicial dele (o Início ou a primeira tela liberada; sem nenhuma, "/" mostra o aviso)
    redirect(paginaInicial(usuario.perfil, usuario.acessos) ?? "/");
  }

  return <TrocarSenhaForm nomeCompleto={`${usuario.nome} ${usuario.sobrenome}`.trim()} />;
}
