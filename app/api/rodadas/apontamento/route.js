import { NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import {
  atualizarBoletim,
  buscarCodigo,
  excluirBoletim,
  gravarBoletim,
  listarCodigos,
  listarLogBoletins,
  obterBoletim,
  proximoBoletim,
  responsavelDaRegiao,
  talhoesDaFazenda,
} from "@/lib/db-rodadas";
import { podeEditar } from "@/lib/permissoes";

export const dynamic = "force-dynamic";

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const CADASTROS_CONSULTA = new Set(["regiao", "fazendas", "ocorrencias", "nivel-infestacao", "presenca-infestacao", "prioridade"]);

/**
 * GET ?cad=<cadastro>&cod=<código> — recupera a descrição de um código;
 * GET sem parâmetros — devolve o número do próximo boletim.
 */
export async function GET(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  const buscaBol = req.nextUrl.searchParams.get("boletim");
  if (buscaBol !== null) {
    const n = Number(buscaBol);
    if (!Number.isInteger(n) || n <= 0) return NextResponse.json({ error: "Informe o número do boletim." }, { status: 400 });
    const b = await obterBoletim(n);
    if (!b) return NextResponse.json({ error: `Boletim ${n} não encontrado.` }, { status: 404 });
    return NextResponse.json({ boletim: b });
  }
  if (req.nextUrl.searchParams.get("log") === "1") {
    const n = Number(req.nextUrl.searchParams.get("bol"));
    return NextResponse.json({ log: await listarLogBoletins(Number.isInteger(n) && n > 0 ? n : undefined) });
  }
  const lista = req.nextUrl.searchParams.get("lista");
  if (lista) {
    if (!CADASTROS_CONSULTA.has(lista)) return NextResponse.json({ error: "Cadastro desconhecido." }, { status: 404 });
    return NextResponse.json({ itens: await listarCodigos(lista) });
  }
  const tlhFaz = req.nextUrl.searchParams.get("talhoes_faz");
  if (tlhFaz !== null) {
    return NextResponse.json({ talhoes: await talhoesDaFazenda(tlhFaz) });
  }
  const regResp = req.nextUrl.searchParams.get("resp_regiao");
  if (regResp !== null) {
    return NextResponse.json({ responsavel: await responsavelDaRegiao(regResp) });
  }
  const cad = req.nextUrl.searchParams.get("cad");
  if (cad) {
    if (!CADASTROS_CONSULTA.has(cad)) return NextResponse.json({ error: "Cadastro desconhecido." }, { status: 404 });
    const r = await buscarCodigo(cad, req.nextUrl.searchParams.get("cod") ?? "");
    // só código e nome (os demais campos do cadastro não saem por aqui)
    return NextResponse.json({ cadastroComItens: r.cadastroComItens, item: r.item ? { cod: r.item.cod, nm: r.item.nm } : null });
  }
  return NextResponse.json({ boletim: await proximoBoletim() });
}

function lerBoletim(body) {
  const rod = Number(body?.rod);
  const dt = typeof body?.dt === "string" ? body.dt : "";
  if (!Number.isInteger(rod) || rod <= 0) return { erro: "Informe a rodada." };
  if (!DATA.test(dt) || Number.isNaN(Date.parse(dt))) return { erro: "Informe a data." };
  const sem = Number(body?.sem);
  if (!Number.isInteger(sem) || sem <= 0) return { erro: "Informe a semana." };
  const texto = (v) => (typeof v === "string" ? v : "");
  const ocos = Array.isArray(body?.ocos) ? body.ocos.slice(0, 50).map(texto).filter(Boolean) : [];
  const talhoes = Array.isArray(body?.talhoes)
    ? body.talhoes.slice(0, 500).map((t) => ({
        tlh: texto(t.tlh),
        area: typeof t.area === "number" && Number.isFinite(t.area) ? t.area : null,
      }))
    : [];
  return {
    b: {
      rod,
      dt,
      sem,
      reg: texto(body?.reg),
      faz: texto(body?.faz),
      pre: texto(body?.pre),
      niv: texto(body?.niv),
      pri: texto(body?.pri),
      ocos,
      outros: texto(body?.outros).slice(0, 200),
      rec: texto(body?.rec),
      talhoes,
    },
  };
}

export async function POST(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para lançar apontamentos." }, { status: 403 });
  }
  const lido = lerBoletim(await req.json().catch(() => null));
  if ("erro" in lido) return NextResponse.json({ error: lido.erro }, { status: 400 });
  const r = await gravarBoletim(lido.b, usuario.nome);
  if ("erro" in r) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json({ ok: true, ...r });
}

/** Altera um boletim lançado (grava no log quem, quando e o antes/depois). */
export async function PUT(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para alterar apontamentos." }, { status: 403 });
  }
  const corpo = await req.json().catch(() => null);
  const bol = Number(corpo?.bol);
  if (!Number.isInteger(bol) || bol <= 0) return NextResponse.json({ error: "Informe o boletim." }, { status: 400 });
  const lido = lerBoletim(corpo);
  if ("erro" in lido) return NextResponse.json({ error: lido.erro }, { status: 400 });
  const r = await atualizarBoletim(bol, lido.b, usuario.nome);
  if ("erro" in r) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json({ ok: true, ...r });
}

/** Exclui um boletim (grava no log quem, quando e o conteúdo excluído). */
export async function DELETE(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para excluir apontamentos." }, { status: 403 });
  }
  const corpo = await req.json().catch(() => null);
  const bol = Number(corpo?.bol);
  if (!Number.isInteger(bol) || bol <= 0) return NextResponse.json({ error: "Informe o boletim." }, { status: 400 });
  const r = await excluirBoletim(bol, usuario.nome);
  if (r !== true) return NextResponse.json({ error: r.erro }, { status: 404 });
  return NextResponse.json({ ok: true });
}
