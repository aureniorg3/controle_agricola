import { NextRequest, NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import { buscarCodigo, gravarBoletim, proximoBoletim, responsavelDaRegiao, type ItemApontamento } from "@/lib/db-rodadas";
import { podeEditar } from "@/lib/permissoes";

export const dynamic = "force-dynamic";

const DATA = /^\d{4}-\d{2}-\d{2}$/;
const CADASTROS_CONSULTA = new Set(["regiao", "fazendas", "ocorrencias", "nivel-infestacao", "presenca-infestacao", "prioridade"]);

/**
 * GET ?cad=<cadastro>&cod=<código> — recupera a descrição de um código;
 * GET sem parâmetros — devolve o número do próximo boletim.
 */
export async function GET(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario) return NextResponse.json({ error: "Sessão expirada. Entre novamente." }, { status: 401 });
  const regResp = req.nextUrl.searchParams.get("resp_regiao");
  if (regResp !== null) {
    return NextResponse.json({ responsavel: await responsavelDaRegiao(regResp) });
  }
  const cad = req.nextUrl.searchParams.get("cad");
  if (cad) {
    if (!CADASTROS_CONSULTA.has(cad)) return NextResponse.json({ error: "Cadastro desconhecido." }, { status: 404 });
    const r = await buscarCodigo(cad, req.nextUrl.searchParams.get("cod") ?? "");
    return NextResponse.json(r);
  }
  return NextResponse.json({ boletim: await proximoBoletim() });
}

export async function POST(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !podeEditar(usuario.perfil)) {
    return NextResponse.json({ error: "Você não tem permissão para lançar apontamentos." }, { status: 403 });
  }
  const body = await req.json().catch(() => null);
  const rod = Number(body?.rod);
  const dt = typeof body?.dt === "string" ? body.dt : "";
  if (!Number.isInteger(rod) || rod <= 0) return NextResponse.json({ error: "Informe a rodada." }, { status: 400 });
  if (!DATA.test(dt) || Number.isNaN(Date.parse(dt))) return NextResponse.json({ error: "Informe a data." }, { status: 400 });
  const texto = (v: unknown) => (typeof v === "string" ? v : "");
  const itens: ItemApontamento[] = Array.isArray(body?.itens)
    ? body.itens.slice(0, 200).map((i: Record<string, unknown>) => ({
        oco: texto(i.oco),
        pre: texto(i.pre),
        niv: texto(i.niv),
        pri: texto(i.pri),
        tlh: texto(i.tlh),
        rec: texto(i.rec),
        ati: texto(i.ati),
        exe: texto(i.exe),
      }))
    : [];
  const r = await gravarBoletim(
    { rod, dt, reg: texto(body?.reg), resp: texto(body?.resp), faz: texto(body?.faz), itens },
    usuario.nome
  );
  if ("erro" in r) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json({ ok: true, ...r });
}
