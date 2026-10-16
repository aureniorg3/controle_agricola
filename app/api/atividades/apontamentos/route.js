import { NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import {
  DIAS_VERIFICAR_OS,
  excluirApontamento,
  listarApontamentos,
  opcoesApontamento,
  proximoBoletimAtividade,
  salvarApontamento,
  verificarOSDoPeriodo,
  vincularOS,
} from "@/lib/db-atividades";
import { analisarConferencia, conferirApontamento, niveisConferencia } from "@/lib/db-conferencia-bot";

import { podeEditar } from "@/lib/permissoes";

export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const texto = (v) => (typeof v === "string" ? v : "");
const inteiro = (v) => (typeof v === "number" ? v : Number(String(v ?? "").trim() || NaN));
const numero = (v) => {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  return s.includes(",") ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
};
const opcional = (v) => (v === null || v === undefined || String(v).trim() === "" ? null : numero(v));

export async function GET(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  const p = req.nextUrl.searchParams;
  if (p.get("proximo") !== null) return NextResponse.json({ boletim: await proximoBoletimAtividade() });
  if (p.get("opcoes") !== null) return NextResponse.json(await opcoesApontamento());
  // `?bol=` o boletim pelo número (em qualquer data), para abrir na tela
  if (p.get("bol") !== null) {
    const n = Number(p.get("bol"));
    if (!Number.isInteger(n) || n <= 0) return NextResponse.json({ error: "Informe o número do boletim." }, { status: 400 });
    const [a] = await listarApontamentos({ boletim: n });
    if (!a) return NextResponse.json({ error: `O boletim nº ${n} não está lançado.` }, { status: 404 });
    return NextResponse.json({ apontamento: a });
  }
  // `?conferencia=<id>` a conferência do apontamento do bot com as O.S. em aberto (e as O.S. compatíveis)
  const conf = p.get("conferencia");
  if (conf !== null && conf !== "lista") {
    const id = Number(conf);
    if (!Number.isInteger(id) || id <= 0) return NextResponse.json({ error: "Informe o apontamento." }, { status: 400 });
    const r = await analisarConferencia(id);
    if (!r) return NextResponse.json({ error: "Apontamento não encontrado." }, { status: 404 });
    return NextResponse.json(r);
  }
  const de = p.get("de") ?? "";
  const ate = p.get("ate") ?? "";
  if (!ISO.test(de) || !ISO.test(ate) || de > ate) return NextResponse.json({ error: "Informe um período válido." }, { status: 400 });
  // `?conferencia=lista` o resultado da conferência dos apontamentos a conferir do período (selo da lista)
  if (conf === "lista") return NextResponse.json({ niveis: await niveisConferencia(de, ate) });
  // `?verificar=1` Verificar O.S.: os apontamentos do período (de qualquer origem) sem O.S. ou fora dela, com as O.S. em
  // aberto compatíveis; período limitado (a varredura lê todos os apontamentos dele)
  if (p.get("verificar") !== null) {
    const dias = Math.round((Date.parse(ate) - Date.parse(de)) / 86400000) + 1;
    if (dias > DIAS_VERIFICAR_OS) {
      return NextResponse.json(
        { error: `Para verificar as O.S., use um período de até ${DIAS_VERIFICAR_OS} dias (o da lista tem ${dias}).` },
        { status: 400 },
      );
    }
    return NextResponse.json(await verificarOSDoPeriodo(de, ate));
  }
  const boletim = Number(p.get("boletim") ?? "");
  return NextResponse.json({
    apontamentos: await listarApontamentos({ de, ate, os: p.get("os") ?? "", boletim: Number.isInteger(boletim) && boletim > 0 ? boletim : undefined }),
  });
}

/** Inclui (sem id) ou altera (com id) um apontamento diário. */
export async function POST(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para lançar apontamentos." }, { status: 403 });
  }
  const b = await req.json().catch(() => null);
  if (!b) return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  const entrada = {
    boletim: inteiro(b.boletim),
    dt: texto(b.dt),
    // a O.S. é opcional: sem ela, cada talhão vem com a fazenda
    semOS: !texto(b.os).trim(),
    os: texto(b.os).trim(),
    opCod: texto(b.opCod),
    opDs: texto(b.opDs),
    modoArea: b.modoArea === "rateio" ? "rateio" : "talhao",
    volume: b.volume === null || b.volume === undefined || b.volume === "" ? null : numero(b.volume),
    solicitante: texto(b.solicitante),
    // sem o campo (tela aberta antes dele): na edição fica o que estava gravado
    apontador: b.apontador === undefined ? undefined : texto(b.apontador),
    etapaCod: texto(b.etapaCod),
    tipoAplicacao: texto(b.tipoAplicacao),
    numEquipamentos: inteiro(b.numEquipamentos),
    numPessoas: inteiro(b.numPessoas),
    obs: texto(b.obs),
    eqp: texto(b.eqp),
    vazaoRec: opcional(b.vazaoRec),
    vazaoUti: opcional(b.vazaoUti),
    volCalda: opcional(b.volCalda),
    insumos: (Array.isArray(b.insumos) ? b.insumos : [])
      .slice(0, 60)
      .map((i) => ({ cod: texto(i.cod), dose: opcional(i.dose), qtd: opcional(i.qtd), dep: texto(i.dep) })),
    talhoes: (Array.isArray(b.talhoes) ? b.talhoes : []).map((t) => ({ propCod: texto(t.propCod), tlh: texto(t.tlh), area: numero(t.area) })),
  };
  const id = b.id === undefined || b.id === null ? undefined : Number(b.id);
  const r = await salvarApontamento(entrada, usuario.nome, id);
  if ("erro" in r) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json({ ok: true, id: r.id, acimaDoTalhao: r.acimaDoTalhao ?? [] });
}

export async function DELETE(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para excluir apontamentos." }, { status: 403 });
  }
  const b = await req.json().catch(() => null);
  const id = Number(b?.id);
  if (!Number.isInteger(id)) return NextResponse.json({ error: "Informe o apontamento." }, { status: 400 });
  const r = await excluirApontamento(id, usuario.nome);
  if (r !== true) return NextResponse.json({ error: r.erro }, { status: 404 });
  return NextResponse.json({ ok: true });
}

/** Confere um apontamento do bot, ou liga um apontamento à O.S. encontrada na Verificar O.S. (ou informada na correção). */
export async function PATCH(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para alterar apontamentos." }, { status: 403 });
  }
  const b = await req.json().catch(() => null);
  const id = Number(b?.id);
  // apontamento do WhatsApp conferido (o bot não regrava mais): com divergência, só com `aceitar` (409 devolve as divergências);
  // só a `versao` analisada na tela (mudou depois: 409 com `mudou`)
  if (b?.conferir === true) {
    if (!Number.isInteger(id)) return NextResponse.json({ error: "Informe o apontamento." }, { status: 400 });
    const r = await conferirApontamento(id, usuario.nome, b.aceitar === true, typeof b.versao === "string" ? b.versao : "");
    if ("erro" in r) return NextResponse.json({ error: r.erro, divergencias: r.divergencias, mudou: r.mudou }, { status: r.status ?? 400 });
    return NextResponse.json(r);
  }
  const os = typeof b?.os === "string" ? b.os.replace(/\D/g, "") : "";
  if (!Number.isInteger(id) || !os) return NextResponse.json({ error: "Informe o apontamento e a O.S." }, { status: 400 });
  // `opCod`: a operação da O.S. escolhida (sem ela, a do apontamento); `versao`: a do apontamento verificado na tela
  const r = await vincularOS(id, os, usuario.nome, {
    opCod: typeof b.opCod === "string" ? b.opCod : undefined,
    versao: typeof b.versao === "string" ? b.versao : "",
  });
  if ("erro" in r) return NextResponse.json({ error: r.erro, mudou: r.mudou }, { status: r.status ?? 400 });
  return NextResponse.json(r);
}
