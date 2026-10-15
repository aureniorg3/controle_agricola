import { usuarioAtual } from "@/lib/db";
import { dadosPainel } from "@/lib/db-painel";
import { todayISO } from "@/lib/format";
import { podeAcessar } from "@/lib/menu";
import { podeIncluirCadastro } from "@/lib/permissoes";
import PainelView from "./PainelView";

export const dynamic = "force-dynamic";

export default async function Page() {
  const usuario = await usuarioAtual();
  // Início não liberado em Parâmetros → Usuários: o AppShell mostra o aviso de sem acesso, e os números nem são
  // calculados (nem saem do servidor)
  if (!podeAcessar("/painel", usuario?.perfil, usuario?.acessos ?? null)) return null;
  const d = await dadosPainel(todayISO());
  // empréstimos só para administrador e gravação (os números e a lista da janela nem saem do servidor para os demais)
  const verEmprestimos = podeIncluirCadastro(usuario?.perfil);
  if (!verEmprestimos) d.insumos.emprestimosAbertos = { n: 0, valor: 0, lista: [] };
  // perfil e telas liberadas: as janelas das caixas só mostram a ligação para as telas que o usuário pode abrir
  return <PainelView d={d} verEmprestimos={verEmprestimos} perfil={usuario?.perfil ?? "leitura"} acessos={usuario?.acessos ?? null} />;
}
