import { listOrdens, listOrdensVisiveis, usuarioAtual } from "@/lib/db";
import OrdensCorteClient from "./OrdensCorteClient";

export const dynamic = "force-dynamic";

export default async function OrdensDeCortePage() {
  const ordens = listOrdens();
  const ordensVisiveis = listOrdensVisiveis();
  const usuario = await usuarioAtual();
  return (
    <OrdensCorteClient
      initialOrdens={ordens}
      initialOrdensVisiveis={ordensVisiveis}
      perfil={usuario?.perfil ?? "leitura"}
    />
  );
}
