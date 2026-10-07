import { usuarioAtual } from "@/lib/db";
import { dadosPainel } from "@/lib/db-painel";
import { todayISO } from "@/lib/format";
import { podeIncluirCadastro } from "@/lib/permissoes";
import PainelView from "./PainelView";

export const dynamic = "force-dynamic";

export default async function Page() {
  const [usuario, d] = await Promise.all([usuarioAtual(), dadosPainel(todayISO())]);
  // empréstimos só para administrador e gravação (os números nem saem do servidor para os demais)
  const verEmprestimos = podeIncluirCadastro(usuario?.perfil);
  if (!verEmprestimos) d.insumos.emprestimosAbertos = { n: 0, valor: 0 };
  return <PainelView d={d} verEmprestimos={verEmprestimos} />;
}
