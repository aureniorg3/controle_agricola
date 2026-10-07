import { NextRequest, NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { atualizarSemanas, criarRodada, excluirRodada, listarRodadasCad } from "@/lib/db-rodadas";
import { gerarSemanas } from "@/lib/rodadas";
import { podeEditar, podeIncluirCadastro } from "@/lib/permissoes";

export const dynamic = "force-dynamic";

const DATA = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  return NextResponse.json({ rodadas: await listarRodadasCad() });
}

/** Cria a rodada: número + data de início (a semana 1 começa na segunda-feira dessa data). */
export async function POST(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para cadastrar rodadas." }, { status: 403 });
  }
  if (!podeIncluirCadastro(usuario.perfil)) {
    return NextResponse.json({ error: "Seu perfil não inclui itens novos nos cadastros; peça a um usuário com perfil Gravação ou Administrador." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const rod = Number(body?.rod);
  const inicio = typeof body?.inicio === "string" ? body.inicio : "";
  if (!Number.isInteger(rod) || rod <= 0) return NextResponse.json({ error: "Informe o número da rodada." }, { status: 400 });
  if (!DATA.test(inicio) || Number.isNaN(Date.parse(inicio))) {
    return NextResponse.json({ error: "Informe a data de início da rodada." }, { status: 400 });
  }
  const r = await criarRodada(rod, inicio, usuario.nome);
  if (r !== true) return NextResponse.json({ error: r.erro }, { status: 409 });
  return NextResponse.json({ ok: true, semanas: gerarSemanas(inicio) });
}

/** Edita as semanas (início e fim) de uma rodada já cadastrada. */
export async function PUT(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para editar rodadas." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const rod = Number(body?.rod);
  if (!Number.isInteger(rod) || rod <= 0) return NextResponse.json({ error: "Informe a rodada." }, { status: 400 });
  const semanas = Array.isArray(body?.semanas)
    ? body.semanas.slice(0, 20).map((s: Record<string, unknown>) => ({
        sem: Number(s.sem),
        ini: typeof s.ini === "string" ? s.ini : "",
        fim: typeof s.fim === "string" ? s.fim : "",
      }))
    : [];
  const r = await atualizarSemanas(rod, semanas, usuario.nome);
  if (r !== true) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para excluir rodadas." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const rod = Number(body?.rod);
  if (!Number.isInteger(rod)) return NextResponse.json({ error: "Informe a rodada." }, { status: 400 });
  const r = await excluirRodada(rod, usuario.nome);
  if (r !== true) return NextResponse.json({ error: r.erro }, { status: 409 });
  return NextResponse.json({ ok: true });
}
