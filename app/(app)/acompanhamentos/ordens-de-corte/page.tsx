import { escolherSafraVigente } from "@/lib/safra-cadastro";
import { historicoTchPorOrdem, listMetas, listOrdens, listSafrasCadastro, listOrdensVisiveis, usuarioAtual } from "@/lib/db";
import OrdensCorteClient from "./OrdensCorteClient";

export const dynamic = "force-dynamic";

export default async function OrdensDeCortePage() {
  const ordens = await listOrdens();
  const ordensVisiveis = await listOrdensVisiveis();
  const metas = await listMetas();
  const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const vigente = escolherSafraVigente(await listSafrasCadastro(), hoje);
  const producao = vigente
    ? { inicio: vigente.producaoInicio, fim: vigente.producaoFim, rotulo: `${vigente.tipo} ${vigente.ano}` }
    : null;
  const safraAtual = parseInt(ordens[0]?.safraLabel ?? "", 10) || new Date().getFullYear();
  const historicoTch = await historicoTchPorOrdem(safraAtual);
  const usuario = await usuarioAtual();
  return (
    <OrdensCorteClient
      initialOrdens={ordens}
      initialOrdensVisiveis={ordensVisiveis}
      metas={metas}
      historicoTch={historicoTch}
      producao={producao}
      perfil={usuario?.perfil ?? "leitura"}
      nomeUsuario={usuario?.nome ?? "Usuário"}
    />
  );
}
