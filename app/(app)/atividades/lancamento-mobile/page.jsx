import { usuarioAtual } from "@/lib/db";
import LancamentoMobileClient from "./LancamentoMobileClient";

export const dynamic = "force-dynamic";

// no iPhone, nº de O.S., matrícula e boletim não viram link de telefone
export const metadata = {
  title: "Lançamento Mobile · Controle Agrícola",
  formatDetection: { telephone: false },
};

export default async function Page() {
  const usuario = await usuarioAtual();
  return <LancamentoMobileClient perfil={usuario?.perfil ?? "leitura"} nomeUsuario={usuario ? `${usuario.nome} ${usuario.sobrenome}`.trim() : ""} />;
}
