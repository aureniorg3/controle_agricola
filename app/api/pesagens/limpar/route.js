import { NextResponse } from "next/server";
import { auditar } from "@/lib/auditar";
import { contarPesagens, getPool, limparPesagens, usuarioDaRequisicao } from "@/lib/db";
import { verificarSenha } from "@/lib/auth";
import { ehAdmin } from "@/lib/permissoes";

export const runtime = "nodejs";

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Limpa do banco as pesagens (viagens e entradas diárias de cana) de um dia
 * ou de um período. Só o administrador, e a limpeza só é feita com a senha
 * dele. Sem `confirmar`, apenas conta o que seria removido.
 */
export async function POST(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !ehAdmin(usuario.perfil)) {
    return NextResponse.json({ error: "Somente o administrador pode limpar pesagens." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const inicio = typeof body?.inicio === "string" ? body.inicio : "";
  const fim = typeof body?.fim === "string" && body.fim ? body.fim : inicio;
  if (!ISO.test(inicio) || !ISO.test(fim) || Number.isNaN(Date.parse(inicio)) || Number.isNaN(Date.parse(fim))) {
    return NextResponse.json({ error: "Informe uma data ou um período válido." }, { status: 400 });
  }
  if (fim < inicio) {
    return NextResponse.json({ error: "A data final não pode ser anterior à inicial." }, { status: 400 });
  }

  if (body?.confirmar !== true) {
    return NextResponse.json({ ...(await contarPesagens(inicio, fim)), inicio, fim });
  }

  const senha = typeof body?.senha === "string" ? body.senha : "";
  if (!senha || !verificarSenha(senha, usuario.senhaHash)) {
    return NextResponse.json({ error: "Senha do administrador incorreta." }, { status: 403 });
  }
  const removidos = await limparPesagens(inicio, fim);
  await auditar(getPool(), { usuario: usuario.nome, modulo: "Colheita", entidade: "Pesagens", chave: `${inicio} a ${fim}`, acao: "limpeza", antes: removidos });
  return NextResponse.json({ ok: true, ...removidos, inicio, fim });
}
