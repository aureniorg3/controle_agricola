/** Tipos e regras (sem banco) de Ordem de Serviço Agr.: base de O.S., faixas de dias e painel. */

/** Posição da O.S. no sistema de origem. */
export const POSICOES: Record<string, string> = { A: "Aberta", L: "Liberada", E: "Encerrada" };
export const nomePosicao = (p: string) => POSICOES[p] ?? (p || "—");
/** aberta ou liberada: ainda não encerrada */
export const emAberto = (p: string) => p !== "E";

/** Uma linha do Relatório de Ordens de Serviço: O.S. × talhão × operação. */
export interface LinhaOSAgr {
  emp: string;
  os: string;
  dtOs: string | null;
  dtEnc: string | null;
  prevIni: string | null;
  prevFim: string | null;
  propCod: string;
  setor: string;
  propNm: string;
  tlh: string;
  letra: string;
  areaPlant: number | null;
  areaRec: number | null;
  opCod: string;
  opDs: string;
  etapaCod: string;
  etapaDs: string;
  ccCod: string;
  ccDs: string;
  safra: string;
  ciclo: string;
  posicao: string;
  mesExec: number | null;
  anoExec: number | null;
  respCod: string;
  respNm: string;
  raio: string;
  usrOs: string;
  obs: string;
}

/** O.S. × operação, já somada por talhão (é o que as telas usam). */
export interface OSOperacao {
  emp: string;
  os: string;
  opCod: string;
  opDs: string;
  etapaCod: string;
  etapaDs: string;
  respCod: string;
  respNm: string;
  posicao: string;
  dtOs: string | null;
  dtEnc: string | null;
  prevFim: string | null;
  usrOs: string;
  safra: string;
  nTlh: number;
  areaRec: number;
  areaPlant: number;
  fazendas: string[];
}

export interface FaixaDias {
  faixa: number;
  descricao: string;
  de: number;
  /** null = sem limite */
  ate: number | null;
}

export const FAIXAS_PADRAO: FaixaDias[] = [
  { faixa: 1, descricao: "Até 7 dias", de: 0, ate: 7 },
  { faixa: 2, descricao: "8 a 15 dias", de: 8, ate: 15 },
  { faixa: 3, descricao: "16 a 30 dias", de: 16, ate: 30 },
  { faixa: 4, descricao: "31 a 60 dias", de: 31, ate: 60 },
  { faixa: 5, descricao: "Acima de 60 dias", de: 61, ate: null },
];

export function faixaDe(dias: number | null, faixas: FaixaDias[]): FaixaDias | null {
  if (dias === null) return null;
  return faixas.find((f) => dias >= f.de && (f.ate === null || dias <= f.ate)) ?? null;
}

const diaUTC = (iso: string) => Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, Number(iso.slice(8, 10)));
export const diasEntre = (de: string, ate: string) => Math.round((diaUTC(ate) - diaUTC(de)) / 86400000);

/** Uma O.S. (todas as operações dela) na lista de Ordens de Serviço. */
export interface OrdemServicoAgr {
  emp: string;
  os: string;
  dtOs: string | null;
  dtEnc: string | null;
  prevFim: string | null;
  posicao: string;
  /** em aberto: dias desde a data da O.S.; encerrada: dias até encerrar */
  dias: number | null;
  /** faixa de dias (só das O.S. em aberto) */
  faixa: string;
  atrasada: boolean;
  operacoes: { cod: string; ds: string; areaRec: number }[];
  etapaCod: string;
  etapaDs: string;
  respCod: string;
  respNm: string;
  usrOs: string;
  safra: string;
  fazendas: string[];
  nTlh: number;
  areaRec: number;
  areaPlant: number;
}

export function agruparPorOS(ops: OSOperacao[], faixas: FaixaDias[], hoje: string): OrdemServicoAgr[] {
  const mapa = new Map<string, OrdemServicoAgr>();
  for (const o of ops) {
    const k = `${o.emp}|${o.os}`;
    let x = mapa.get(k);
    if (!x) {
      x = {
        emp: o.emp, os: o.os, dtOs: o.dtOs, dtEnc: o.dtEnc, prevFim: o.prevFim, posicao: o.posicao, dias: null, faixa: "", atrasada: false,
        operacoes: [], etapaCod: o.etapaCod, etapaDs: o.etapaDs, respCod: o.respCod, respNm: o.respNm, usrOs: o.usrOs, safra: o.safra,
        fazendas: [], nTlh: 0, areaRec: 0, areaPlant: 0,
      };
      mapa.set(k, x);
    }
    x.operacoes.push({ cod: o.opCod, ds: o.opDs, areaRec: o.areaRec });
    x.nTlh += o.nTlh;
    x.areaRec += o.areaRec;
    x.areaPlant += o.areaPlant;
    for (const f of o.fazendas) if (!x.fazendas.includes(f)) x.fazendas.push(f);
    if (o.dtEnc && (!x.dtEnc || o.dtEnc > x.dtEnc)) x.dtEnc = o.dtEnc;
    if (o.prevFim && (!x.prevFim || o.prevFim > x.prevFim)) x.prevFim = o.prevFim;
  }
  const lista = [...mapa.values()];
  for (const x of lista) {
    x.areaRec = round2(x.areaRec);
    x.areaPlant = round2(x.areaPlant);
    if (x.dtOs) {
      if (emAberto(x.posicao)) {
        x.dias = Math.max(0, diasEntre(x.dtOs, hoje));
        x.faixa = faixaDe(x.dias, faixas)?.descricao ?? "";
        x.atrasada = !!x.prevFim && x.prevFim < hoje;
      } else if (x.dtEnc) {
        x.dias = Math.max(0, diasEntre(x.dtOs, x.dtEnc));
      }
    }
  }
  return lista.sort((a, b) => (b.dtOs ?? "").localeCompare(a.dtOs ?? "") || Number(b.os) - Number(a.os) || b.os.localeCompare(a.os));
}

export const round2 = (n: number) => Math.round(n * 100) / 100;

// ---------------------------------------------------------------------------
// Painel (Dashboard)
// ---------------------------------------------------------------------------

export interface LinhaGrupoOS {
  chave: string;
  nome: string;
  /** área do responsável (Cadastro Responsáveis), só no agrupamento por solicitante */
  area?: string;
  ordens: number;
  abertas: number;
  liberadas: number;
  encerradas: number;
  atrasadas: number;
  areaRec: number;
  areaRecEncerrada: number;
  /** média de dias até encerrar */
  mediaDias: number | null;
}

export interface PainelOS {
  total: number;
  abertas: number;
  liberadas: number;
  encerradas: number;
  atrasadas: number;
  areaRec: number;
  areaRecEncerrada: number;
  areaRecAberta: number;
  mediaDiasEncerrar: number | null;
  faixas: { descricao: string; ordens: number; areaRec: number }[];
  porSolicitante: LinhaGrupoOS[];
  porArea: LinhaGrupoOS[];
  porOperacao: LinhaGrupoOS[];
  porEtapa: LinhaGrupoOS[];
  porMes: { mes: string; emitidas: number; encerradas: number }[];
}

export function montarPainelOS(
  ordens: OrdemServicoAgr[],
  faixas: FaixaDias[],
  responsaveis: Map<string, { nome: string; area: string }>
): PainelOS {
  const novoGrupo = (chave: string, nome: string, area?: string): LinhaGrupoOS & { _dias: number[] } => ({
    chave, nome, area, ordens: 0, abertas: 0, liberadas: 0, encerradas: 0, atrasadas: 0, areaRec: 0, areaRecEncerrada: 0, mediaDias: null, _dias: [],
  });
  const somar = (g: LinhaGrupoOS & { _dias: number[] }, o: OrdemServicoAgr, areaRec: number) => {
    g.ordens++;
    if (o.posicao === "A") g.abertas++;
    else if (o.posicao === "L") g.liberadas++;
    else g.encerradas++;
    if (o.atrasada) g.atrasadas++;
    g.areaRec += areaRec;
    if (!emAberto(o.posicao)) {
      g.areaRecEncerrada += areaRec;
      if (o.dias !== null) g._dias.push(o.dias);
    }
  };
  const fechar = (m: Map<string, LinhaGrupoOS & { _dias: number[] }>) =>
    [...m.values()]
      .map(({ _dias, ...g }) => ({
        ...g,
        areaRec: round2(g.areaRec),
        areaRecEncerrada: round2(g.areaRecEncerrada),
        mediaDias: _dias.length ? Math.round((_dias.reduce((a, b) => a + b, 0) / _dias.length) * 10) / 10 : null,
      }))
      .sort((a, b) => b.ordens - a.ordens || b.areaRec - a.areaRec);

  const solic = new Map<string, LinhaGrupoOS & { _dias: number[] }>();
  const area = new Map<string, LinhaGrupoOS & { _dias: number[] }>();
  const oper = new Map<string, LinhaGrupoOS & { _dias: number[] }>();
  const etapa = new Map<string, LinhaGrupoOS & { _dias: number[] }>();
  const meses = new Map<string, { emitidas: number; encerradas: number }>();
  const porFaixa = new Map<string, { ordens: number; areaRec: number }>(faixas.map((f) => [f.descricao, { ordens: 0, areaRec: 0 }]));
  const tot = novoGrupo("", "");

  for (const o of ordens) {
    somar(tot, o, o.areaRec);
    const cad = responsaveis.get(o.respCod);
    const nomeResp = o.respNm || cad?.nome || (o.respCod && o.respCod !== "0" ? o.respCod : "Sem responsável");
    const kResp = o.respCod && o.respCod !== "0" ? o.respCod : "";
    if (!solic.has(kResp)) solic.set(kResp, novoGrupo(kResp, nomeResp, cad?.area || ""));
    somar(solic.get(kResp)!, o, o.areaRec);
    const kArea = cad?.area || "Sem área no cadastro";
    if (!area.has(kArea)) area.set(kArea, novoGrupo(kArea, kArea));
    somar(area.get(kArea)!, o, o.areaRec);
    if (!etapa.has(o.etapaCod)) etapa.set(o.etapaCod, novoGrupo(o.etapaCod, o.etapaDs || o.etapaCod || "Sem etapa"));
    somar(etapa.get(o.etapaCod)!, o, o.areaRec);
    for (const op of o.operacoes) {
      if (!oper.has(op.cod)) oper.set(op.cod, novoGrupo(op.cod, op.ds || op.cod));
      somar(oper.get(op.cod)!, o, op.areaRec);
    }
    if (o.dtOs) {
      const m = o.dtOs.slice(0, 7);
      if (!meses.has(m)) meses.set(m, { emitidas: 0, encerradas: 0 });
      meses.get(m)!.emitidas++;
    }
    if (!emAberto(o.posicao) && o.dtEnc) {
      const m = o.dtEnc.slice(0, 7);
      if (!meses.has(m)) meses.set(m, { emitidas: 0, encerradas: 0 });
      meses.get(m)!.encerradas++;
    }
    if (emAberto(o.posicao) && o.faixa && porFaixa.has(o.faixa)) {
      const f = porFaixa.get(o.faixa)!;
      f.ordens++;
      f.areaRec += o.areaRec;
    }
  }
  const t = fechar(new Map([["", tot]]))[0];
  return {
    total: t.ordens,
    abertas: t.abertas,
    liberadas: t.liberadas,
    encerradas: t.encerradas,
    atrasadas: t.atrasadas,
    areaRec: t.areaRec,
    areaRecEncerrada: t.areaRecEncerrada,
    areaRecAberta: round2(t.areaRec - t.areaRecEncerrada),
    mediaDiasEncerrar: t.mediaDias,
    faixas: [...porFaixa].map(([descricao, f]) => ({ descricao, ordens: f.ordens, areaRec: round2(f.areaRec) })),
    porSolicitante: fechar(solic),
    porArea: fechar(area),
    porOperacao: fechar(oper),
    porEtapa: fechar(etapa).sort((a, b) => a.chave.localeCompare(b.chave, "pt-BR", { numeric: true })),
    porMes: [...meses].sort((a, b) => a[0].localeCompare(b[0])).map(([mes, v]) => ({ mes, ...v })),
  };
}

// ---------------------------------------------------------------------------
// Importação: prévia do que muda
// ---------------------------------------------------------------------------

export interface PreviaImportacaoOS {
  arquivo: { linhas: number; ordens: number; repetidas: number; periodo: string };
  novas: number;
  alteradas: number;
  iguais: number;
  /** O.S. da base que não vieram no arquivo (continuam como estão) */
  foraDoArquivo: number;
  mudancas: { posicao: number; encerradas: number; talhoes: number; areas: number; outros: number };
  exemplos: { os: string; texto: string }[];
}
