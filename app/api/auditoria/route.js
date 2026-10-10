import { NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { listarAuditoria, opcoesAuditoria } from "@/lib/auditoria";

export const dynamic = "force-dynamic";

const DATA = /^\d{4}-\d{2}-\d{2}$/;

const ACOES = ["inclusao", "alteracao", "exclusao", "importacao", "limpeza"];

/** Log de alterações do sistema (filtros: programa — id ou "grupo:<nome>" —, modulo, acao, usuario, q, de, ate, entidade, chave). */
export async function GET(req) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  const p = req.nextUrl.searchParams;
  const data = (v) => (v && DATA.test(v) ? v : undefined);
  const registros = await listarAuditoria({
    programa: p.get("programa") || undefined,
    modulo: p.get("modulo") || undefined,
    acao: ACOES.includes(p.get("acao") ?? "") ? p.get("acao") : undefined,
    usuario: p.get("usuario") || undefined,
    q: p.get("q") || undefined,
    de: data(p.get("de")),
    ate: data(p.get("ate")),
    entidade: p.get("entidade") || undefined,
    chave: p.get("chave") || undefined,
  });
  const opcoes = p.get("opcoes") === "1" ? await opcoesAuditoria() : undefined;
  return NextResponse.json({ registros, opcoes });
}
