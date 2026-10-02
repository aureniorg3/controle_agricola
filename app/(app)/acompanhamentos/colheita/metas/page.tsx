import { listMetas, listOrdens, usuarioAtual } from "@/lib/db";
import MetasClient from "./MetasClient";

export const dynamic = "force-dynamic";

export default async function MetasPage() {
  const [metas, ordens, usuario] = await Promise.all([listMetas(), listOrdens(), usuarioAtual()]);
  const frentes = Array.from(new Set(ordens.map((o) => o.frente))).sort((a, b) => a.localeCompare(b));
  return <MetasClient metasIniciais={metas} frentes={frentes} perfil={usuario?.perfil ?? "leitura"} />;
}
