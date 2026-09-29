import { listOrdens, usuarioAtual } from "@/lib/db";
import OrdensCorteClient from "./OrdensCorteClient";

export const dynamic = "force-dynamic";

export default async function OrdensDeCortePage() {
  const ordens = listOrdens();
  const usuario = await usuarioAtual();
  return <OrdensCorteClient initialOrdens={ordens} perfil={usuario?.perfil ?? "leitura"} />;
}
