import { listConferencias, listEquiptoFrente, listOrdensParaConferencia, usuarioAtual } from "@/lib/db";
import EquiptoFrenteClient from "./EquiptoFrenteClient";

export const dynamic = "force-dynamic";

export default async function EquiptoFrentePage() {
  const [lancamentos, conferencias, ordens, usuario] = await Promise.all([
    listEquiptoFrente(),
    listConferencias(),
    listOrdensParaConferencia(),
    usuarioAtual(),
  ]);

  const frentes = Array.from(new Set([...ordens.map((o) => o.frente), ...conferencias.map((c) => c.frente), ...lancamentos.map((l) => l.frente)])).sort(
    (a, b) => a.localeCompare(b),
  );

  const nomes = {};
  for (const c of conferencias) if (c.eqpNome) nomes[c.eqp] = c.eqpNome;

  return <EquiptoFrenteClient lancamentosIniciais={lancamentos} frentes={frentes} nomesEquipamentos={nomes} perfil={usuario?.perfil ?? "leitura"} />;
}
