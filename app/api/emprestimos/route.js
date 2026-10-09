import { NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { baixarEmprestimo, excluirEmprestimo, listarEmprestimos, proximoBoletimEmprestimo, salvarEmprestimo } from "@/lib/db-emprestimos";

import { podeEditar } from "@/lib/permissoes";

export const dynamic = "force-dynamic";

const texto = (v) => (typeof v === "string" ? v : "");
const numero = (v) => (typeof v === "number" && Number.isFinite(v) ? v : Number(String(v ?? "").replace(",", ".")));
const dataOuNull = (v) => (typeof v === "string" && v ? v : null);

function lerEntrada(b) {
  const lista = (v) => (Array.isArray(v) ? v : []);
  return {
    boletim: b.boletim === null || b.boletim === undefined || b.boletim === "" ? null : Number(b.boletim),
    fornCod: texto(b.fornCod),
    fornNm: texto(b.fornNm),
    doc: texto(b.doc),
    dt: dataOuNull(b.dt),
    dtSol: dataOuNull(b.dtSol),
    faz: lista(b.faz).map((f) => ({
      cod: texto(f.cod),
      nome: texto(f.nome),
      area: f.area === null || f.area === "" || f.area === undefined ? null : numero(f.area),
    })),
    vol: texto(b.vol),
    volTipo: b.volTipo === "Insumo" ? "Insumo" : "Calda",
    assin: (Array.isArray(b.assin) ? b.assin : []).map(texto),
    itens: lista(b.itens).map((i) => ({
      cod: texto(i.cod),
      nm: texto(i.nm),
      um: texto(i.um),
      dose: i.dose === null || i.dose === "" || i.dose === undefined ? null : numero(i.dose),
      qtd: numero(i.qtd),
      vu: numero(i.vu),
    })),
    obs: texto(b.obs),
  };
}

export async function GET(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  if (req.nextUrl.searchParams.get("proximo") !== null) return NextResponse.json({ boletim: await proximoBoletimEmprestimo() });
  return NextResponse.json({ emprestimos: await listarEmprestimos() });
}

/** Inclui (sem id) ou altera (com id) um empréstimo; `acao: "baixa"` dá baixa/reabre. */
export async function POST(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para lançar empréstimos." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  const id = body.id === undefined ? undefined : Number(body.id);

  if (body.acao === "baixa") {
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Informe o empréstimo." }, { status: 400 });
    const tipo = body.tipo === "Pago" || body.tipo === "Devolvido" || body.tipo === "Aberto" ? body.tipo : null;
    if (!tipo) return NextResponse.json({ error: "Tipo de baixa inválido." }, { status: 400 });
    const r = await baixarEmprestimo(id, { tipo, data: texto(body.data), obs: texto(body.obs) }, usuario.nome);
    if (r !== true) return NextResponse.json({ error: r.erro }, { status: 400 });
    return NextResponse.json({ ok: true });
  }

  const r = await salvarEmprestimo(lerEntrada(body), usuario.nome, id);
  if ("erro" in r) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json({ ok: true, id: r.id });
}

export async function DELETE(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para excluir empréstimos." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const id = Number(body?.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Informe o empréstimo." }, { status: 400 });
  const r = await excluirEmprestimo(id, usuario.nome);
  if (r !== true) return NextResponse.json({ error: r.erro }, { status: 404 });
  return NextResponse.json({ ok: true });
}
