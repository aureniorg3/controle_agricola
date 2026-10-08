import { NextRequest, NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import {
  excluirApontamento,
  listarApontamentos,
  opcoesApontamento,
  proximoBoletimAtividade,
  salvarApontamento,
  verificarSemOS,
  vincularOS,
} from "@/lib/db-atividades";
import type { EntradaApontamento } from "@/lib/atividades";
import { podeEditar } from "@/lib/permissoes";

export const dynamic = "force-dynamic";

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const texto = (v: unknown) => (typeof v === "string" ? v : "");
const inteiro = (v: unknown) => (typeof v === "number" ? v : Number(String(v ?? "").trim() || NaN));
const numero = (v: unknown) => {
  if (typeof v === "number") return v;
  const s = String(v ?? "").trim();
  return s.includes(",") ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
};
const opcional = (v: unknown) => (v === null || v === undefined || String(v).trim() === "" ? null : numero(v));

export async function GET(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  const p = req.nextUrl.searchParams;
  if (p.get("proximo") !== null) return NextResponse.json({ boletim: await proximoBoletimAtividade() });
  if (p.get("opcoes") !== null) return NextResponse.json(await opcoesApontamento());
  const de = p.get("de") ?? "";
  const ate = p.get("ate") ?? "";
  if (!ISO.test(de) || !ISO.test(ate) || de > ate) return NextResponse.json({ error: "Informe um período válido." }, { status: 400 });
  if (p.get("verificar") !== null) return NextResponse.json({ semOS: await verificarSemOS(de, ate) });
  const boletim = Number(p.get("boletim") ?? "");
  return NextResponse.json({ apontamentos: await listarApontamentos({ de, ate, os: p.get("os") ?? "", boletim: Number.isInteger(boletim) && boletim > 0 ? boletim : undefined }) });
}

/** Inclui (sem id) ou altera (com id) um apontamento diário. */
export async function POST(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para lançar apontamentos." }, { status: 403 });
  }
  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!b) return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  const entrada: EntradaApontamento = {
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
    etapaCod: texto(b.etapaCod),
    tipoAplicacao: texto(b.tipoAplicacao),
    numEquipamentos: inteiro(b.numEquipamentos),
    numPessoas: inteiro(b.numPessoas),
    obs: texto(b.obs),
    eqp: texto(b.eqp),
    vazaoRec: opcional(b.vazaoRec),
    vazaoUti: opcional(b.vazaoUti),
    volCalda: opcional(b.volCalda),
    talhoes: (Array.isArray(b.talhoes) ? (b.talhoes as Record<string, unknown>[]) : []).map((t) => ({ propCod: texto(t.propCod), tlh: texto(t.tlh), area: numero(t.area) })),
  };
  const id = b.id === undefined || b.id === null ? undefined : Number(b.id);
  const r = await salvarApontamento(entrada, usuario.nome, id);
  if ("erro" in r) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json({ ok: true, id: r.id });
}

export async function DELETE(req: NextRequest) {
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

/** Liga um apontamento lançado sem O.S. à O.S. encontrada na verificação (ou informada na correção). */
export async function PATCH(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para alterar apontamentos." }, { status: 403 });
  }
  const b = await req.json().catch(() => null);
  const id = Number(b?.id);
  const os = typeof b?.os === "string" ? b.os.replace(/\D/g, "") : "";
  if (!Number.isInteger(id) || !os) return NextResponse.json({ error: "Informe o apontamento e a O.S." }, { status: 400 });
  const r = await vincularOS(id, os, usuario.nome);
  if ("erro" in r) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json(r);
}
