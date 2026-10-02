import { listMetas, listOrdens, listOrdensVisiveis, usuarioAtual } from "@/lib/db";
import OrdensCorteClient from "./OrdensCorteClient";

export const dynamic = "force-dynamic";

export default async function OrdensDeCortePage() {
  const ordens = await listOrdens();
  const ordensVisiveis = await listOrdensVisiveis();
  const metas = await listMetas();
  const usuario = await usuarioAtual();
  return (
    <OrdensCorteClient
      initialOrdens={ordens}
      initialOrdensVisiveis={ordensVisiveis}
      metas={metas}
      perfil={usuario?.perfil ?? "leitura"}
      nomeUsuario={usuario?.nome ?? "Usuário"}
    />
  );
}
