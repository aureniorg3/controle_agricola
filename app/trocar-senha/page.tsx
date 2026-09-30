import { redirect } from "next/navigation";
import { usuarioAtual } from "@/lib/db";
import TrocarSenhaForm from "./TrocarSenhaForm";

export const dynamic = "force-dynamic";

export default async function TrocarSenhaPage() {
  const usuario = await usuarioAtual();

  if (!usuario) {
    redirect("/login");
  }
  if (!usuario.precisaTrocarSenha) {
    redirect("/");
  }

  return <TrocarSenhaForm nomeCompleto={`${usuario.nome} ${usuario.sobrenome}`.trim()} />;
}
