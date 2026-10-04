import { NextRequest, NextResponse } from "next/server";
import { usuarioDaRequisicao } from "@/lib/db";
import {
  buscarCodigo,
  gravarBoletim,
  listarCodigos,
  proximoBoletim,
  responsavelDaRegiao,
  talhoesDaFazenda,
  type TalhaoApontamento,
} from "@/lib/db-rodadas";
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
  const ocos: string[] = Array.isArray(body?.ocos) ? body.ocos.slice(0, 50).map(texto).filter(Boolean) : [];
  const talhoes: TalhaoApontamento[] = Array.isArray(body?.talhoes)
    ? body.talhoes.slice(0, 500).map((t: Record<string, unknown>) => ({
        tlh: texto(t.tlh),
        area: typeof t.area === "number" && Number.isFinite(t.area) ? t.area : null,
      }))
    : [];
  const r = await gravarBoletim(
    {
      rod,
      dt,
      reg: texto(body?.reg),
      faz: texto(body?.faz),
      pre: texto(body?.pre),
      niv: texto(body?.niv),
      pri: texto(body?.pri),
      ocos,
      rec: texto(body?.rec),
      talhoes,
    },
    usuario.nome
  );
  if ("erro" in r) return NextResponse.json({ error: r.erro }, { status: 400 });
  return NextResponse.json({ ok: true, ...r });
}
