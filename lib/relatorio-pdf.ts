import type { FrenteResumo, LinhaResumoDetalhado, MediaDiaria, MetasPorPeriodo, ResumoMensal, TotaisResumoDetalhado } from "./period";
import {
  addDays,
  calcAreaColhidaHa,
  calcOrdemMetrics,
  calcProducaoAreaColhida,
  calcTalhaoDiaAnterior,
  calcTalhaoDiaAtualAte6h,
  calcTalhaoEntradaPeriodo,
  mesAnteriorRange,
  quinzenaRange,
  startOfMonth,
  startOfWeekMonday,
} from "./period";
import { fmtDateBR, fmtHa, fmtT, fmtTch, rotuloMesAbrev } from "./format";
import { agruparClimaPorEstacao, itensClima, rotuloClima, type ClimaResp } from "./clima";
import type { HistoricoTchOrdem, OrdemCorte, Periodo, TalhaoOrdem } from "./types";

const EMPRESA = "CRV Industrial";
const MARGEM = 10;
const RODAPE_ALTURA = 20;
const CABECALHO_ALTURA = 17.4;

// Tokens do padrão visual CRV Industrial.
const NAVY: [number, number, number] = [35, 57, 107]; // #23396B
const GREEN: [number, number, number] = [45, 138, 90]; // #2D8A5A
const LINE: [number, number, number] = [213, 219, 225]; // #D5DBE1
const ALT_ROW: [number, number, number] = [244, 246, 248]; // #F4F6F8
const INK: [number, number, number] = [20, 26, 36];
const MUTED: [number, number, number] = [92, 102, 117];
// Mesmas cores do badge de status da tela (Aberta=verde, Encerrada=âmbar).
const STATUS_ABERTA: [number, number, number] = [22, 100, 48];
const STATUS_ENCERRADA: [number, number, number] = [167, 110, 19];
const BOM: [number, number, number] = [22, 100, 48];
const ATENCAO: [number, number, number] = [167, 110, 19];
const ALERTA: [number, number, number] = [178, 60, 43];

type TomKpi = "blue" | "green" | "amber" | "red";
const TONS_KPI: Record<TomKpi, { fundo: [number, number, number]; texto: [number, number, number] }> = {
  blue: { fundo: [238, 244, 253], texto: [23, 58, 120] },
  green: { fundo: [232, 245, 233], texto: [22, 100, 48] },
  amber: { fundo: [255, 243, 224], texto: [167, 110, 19] },
  red: { fundo: [255, 235, 238], texto: [178, 60, 43] },
};

export interface KpiRelatorio {
  label: string;
  value: string;
  sub?: string;
  tom: TomKpi;
}

export interface ResumoDetalhadoFrente {
  frente: string;
  linhas: LinhaResumoDetalhado[];
  subtotal: TotaisResumoDetalhado;
}

export interface DadosRelatorioCompleto {
  titulo: string;
  safraLabel: string;
  referencia: string;
  period: Periodo;
  periodLabel: string;
  resumoFrentes: FrenteResumo[];
  resumoTotais: Omit<FrenteResumo, "frente" | "meta">;
  /** média de t por dia efetivo em cada recorte do resumo (todas as frentes) */
  mediaDiaria: Record<"safra" | "mesAnterior" | "mesAtual" | "quinzena" | "semana" | "diaAnterior" | "diaAtual", MediaDiaria>;
  /** meta somada de todas as frentes em cada período (linha Total geral) */
  metaTotais: MetasPorPeriodo;
  /** os 8 cards do topo da tela */
  kpis: KpiRelatorio[];
  /** TCH das safras anteriores / estimado da safra atual por ordem */
  historicoTch: HistoricoTchOrdem;
  /** horário de corte do dia atual: 6, 12, 18 ou 24 (00:00) */
  horaCorte: number;
  /** ordens com TCH real (ton ÷ área medida) divergente do estimado — só para Gravação/Admin */
  divergenciaPorOrdem: Record<string, number>;
  /** início da produção da safra vigente (cadastro de safras), quando houver */
  producaoDesde?: string;
  porFrente: [string, OrdemCorte[]][];
  resumoDetalhadoPorFrente: ResumoDetalhadoFrente[];
  resumoDetalhadoTotalGeral: TotaisResumoDetalhado;
  /** resumo diário do mês selecionado: uma linha por dia, uma coluna por frente */
  resumoMensal: ResumoMensal;
  nomeUsuario: string;
  /** clima da Zeus por fazenda para a data de referência (rodapé de cada card); omitido se indisponível */
  clima?: ClimaRelatorio | null;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export async function carregarImagemInfo(url: string): Promise<{ dataUrl: string; largura: number; altura: number } | null> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ dataUrl, largura: img.naturalWidth, altura: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  } catch {
    return null;
  }
}

/** Colunas da mini-tabela de talhões dentro de cada card de ordem. */
function colunasCard(xStart: number, largura: number) {
  const wTalhao = largura * 0.24;
  const wResto = (largura - wTalhao) / 4;
  return [
    { x: xStart + wTalhao / 2 - 1, align: "center" as const },
    { x: xStart + wTalhao + wResto, align: "right" as const },
    { x: xStart + wTalhao + wResto * 2, align: "right" as const },
    { x: xStart + wTalhao + wResto * 3, align: "right" as const },
    { x: xStart + wTalhao + wResto * 4, align: "right" as const },
  ];
}

function desenharLinhaCard(
  doc: import("jspdf").jsPDF,
  cols: { x: number; align: "left" | "right" | "center" }[],
  valores: (string | number)[],
  y: number
) {
  valores.forEach((v, i) => doc.text(String(v), cols[i].x, y, { align: cols[i].align }));
}

/** Clima da Zeus por fazenda (mesmo formato da rota /api/clima/chuva). */
export type ClimaRelatorio = ClimaResp;

const fmtClima = (n: number | null | undefined, casas = 0) =>
  n == null ? "—" : n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });

type TipoIcone = "chuva" | "termometro" | "gota" | "vento" | "sol";

/** Ícones de clima em traço fino (~3 mm), desenhados com primitivas do jsPDF. */
function desenharIcone(doc: import("jspdf").jsPDF, tipo: TipoIcone, cx: number, cy: number, cor: [number, number, number]) {
  doc.setDrawColor(...cor);
  doc.setLineWidth(0.22);
  if (tipo === "chuva") {
    doc.circle(cx - 0.6, cy - 0.7, 0.85, "S");
    doc.circle(cx + 0.7, cy - 0.5, 0.7, "S");
    doc.line(cx - 1.4, cy + 0.1, cx + 1.4, cy + 0.1);
    doc.line(cx - 0.9, cy + 0.6, cx - 1.2, cy + 1.4);
    doc.line(cx, cy + 0.6, cx - 0.3, cy + 1.4);
    doc.line(cx + 0.9, cy + 0.6, cx + 0.6, cy + 1.4);
  } else if (tipo === "termometro") {
    doc.roundedRect(cx - 0.35, cy - 1.5, 0.7, 2.2, 0.35, 0.35, "S");
    doc.circle(cx, cy + 1.05, 0.7, "S");
    doc.line(cx, cy - 0.4, cx, cy + 0.8);
  } else if (tipo === "gota") {
    doc.triangle(cx, cy - 1.6, cx - 0.95, cy + 0.1, cx + 0.95, cy + 0.1, "S");
    doc.circle(cx, cy + 0.55, 0.95, "S");
  } else if (tipo === "vento") {
    doc.line(cx - 1.5, cy - 0.8, cx + 0.9, cy - 0.8);
    doc.line(cx - 1.5, cy, cx + 1.5, cy);
    doc.line(cx - 1.5, cy + 0.8, cx + 0.4, cy + 0.8);
  } else {
    doc.circle(cx, cy, 0.75, "S");
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      doc.line(cx + Math.cos(a) * 1.15, cy + Math.sin(a) * 1.15, cx + Math.cos(a) * 1.65, cy + Math.sin(a) * 1.65);
    }
  }
}

/**
 * Monta (mede, mas não desenha) um card de ordem no formato novo da tela:
 * faixa lateral de status, talhões à esquerda (com o bloco de TCH embaixo) e,
 * à direita, áreas, progresso da colheita, produção do período, TCH geral com
 * selo e tipo de cana. Devolve a altura exata que vai ocupar e uma função
 * `desenhar(x, y)` pra posicionar no grid de 3 colunas.
 */
function montarCardOrdem(
  doc: import("jspdf").jsPDF,
  ordem: OrdemCorte,
  period: Periodo,
  referencia: string,
  largura: number,
  tch: {
    historico?: HistoricoTchOrdem["porOrdem"][string];
    safraAtual: number;
    safrasAnteriores: number[];
    divergenciaPct?: number;
  },
  clima?: ClimaRelatorio | null
): { altura: number; desenhar: (x: number, y: number) => void } {
  const pad = 2.6;
  const faixa = 1.3;
  const gapColunas = 3;
  const larguraInterna = largura - faixa - pad * 2;
  const larguraEsq = Math.round(larguraInterna * 0.62 * 10) / 10;
  const larguraDir = larguraInterna - larguraEsq - gapColunas;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.4);
  const fazendas = [...new Set(ordem.talhoes.map((t) => `${t.fazendaCodigo} · ${t.fazendaNome}`))].join("   ");
  const linhasFazenda = doc.splitTextToSize(fazendas || "Sem talhão cadastrado", larguraInterna - 20) as string[];

  const m = calcOrdemMetrics(ordem, period, referencia);
  const areaColhidaHa = calcAreaColhidaHa(ordem);
  // TCH médio realizado: tonelada entregue ÷ área colhida apontada
  // quadro: produção que entrou pela área colhida apontada ÷ essa área; linha do bloco de TCH: entrada total ÷ área da ordem
  const tchMedio = calcProducaoAreaColhida(ordem, referencia).tch;
  const progresso = m.areaTotalHa > 0 ? Math.min(100, Math.round((areaColhidaHa / m.areaTotalHa) * 100)) : 0;
  const diaAnteriorIso = addDays(referencia, -1);
  const totalDiaAnteriorT = round2(
    ordem.entradas.filter((e) => e.data === diaAnteriorIso).reduce((s, e) => s + e.toneladas, 0)
  );
  const totalDiaAtual6hT = round2(
    ordem.entradas.filter((e) => e.data === referencia).reduce((s, e) => s + e.toneladasAte6h, 0)
  );

  // bloco de TCH (rodapé da coluna dos talhões); campos sem dado ficam em branco
  const realDe = (safra: number) => tch.historico?.find((h) => h.safra === safra)?.tchReal ?? null;
  const estimado = tch.historico?.find((h) => h.safra === tch.safraAtual)?.tchEst ?? null;
  const mostrarTch = tch.safrasAnteriores.length > 0 || !!tch.historico;
  const linhasTch: { texto: string; valor: string; fundo: [number, number, number] }[] = mostrarTch
    ? [
        { texto: "Área Liberada (Ordem)", valor: fmtHa(m.areaTotalHa), fundo: [232, 245, 233] },
        ...[...tch.safrasAnteriores].reverse().map((safra) => ({
          texto: `TCH Realizado Safra ${safra}`,
          valor: realDe(safra) !== null ? fmtTch(realDe(safra)!) : "",
          fundo: [255, 255, 232] as [number, number, number],
        })),
        { texto: `TCH Estimado ${tch.safraAtual}`, valor: estimado !== null ? fmtTch(estimado) : "", fundo: [255, 255, 232] },
        ...(tch.divergenciaPct !== undefined
          ? [
              {
                texto: "(!) TCH real vs. estimado",
                valor: `${tch.divergenciaPct >= 0 ? "+" : "-"}${Math.abs(tch.divergenciaPct).toFixed(0)}%`,
                fundo: [255, 243, 224] as [number, number, number],
              },
            ]
          : []),
        { texto: "TCH Médio Realizado", valor: fmtTch(m.tchGeralRealizado), fundo: [255, 243, 224] },
      ]
    : [];
  const alturaLinhaTch = 3.3;

  const nTalhoes = ordem.talhoes.length;
  const alturaLinhaTalhao = 3.3;
  // ordem com mais de uma fazenda: talhões agrupados por fazenda, cada grupo com a sua faixa
  // (o número do talhão se repete entre fazendas e sem a faixa não dá para saber de qual é)
  const gruposFazenda: { fazendaCodigo: string; fazendaNome: string; talhoes: TalhaoOrdem[] }[] = [];
  for (const t of ordem.talhoes) {
    let g = gruposFazenda.find((x) => x.fazendaCodigo === t.fazendaCodigo);
    if (!g) {
      g = { fazendaCodigo: t.fazendaCodigo, fazendaNome: t.fazendaNome, talhoes: [] };
      gruposFazenda.push(g);
    }
    g.talhoes.push(t);
  }
  const variasFazendas = gruposFazenda.length > 1;
  const linhasTalhoes: ({ faixa: string } | { talhao: TalhaoOrdem })[] = gruposFazenda.flatMap((g) => [
    ...(variasFazendas ? [{ faixa: `${g.fazendaCodigo} · ${g.fazendaNome}` }] : []),
    ...g.talhoes.map((t) => ({ talhao: t })),
  ]);
  // rodapé de clima (Zeus): um bloco por estação (fazendas da mesma estação juntas), 2 linhas x 3 itens quando há leitura
  const climaFazendas = clima
    ? agruparClimaPorEstacao(
        gruposFazenda.map((g) => ({ codigo: g.fazendaCodigo, nome: g.fazendaNome })),
        clima
      )
    : [];
  const temClima = climaFazendas.some((x) => x.c);
  const alturaLinhaClima = 6.6;
  // título de cada bloco (as fazendas da estação), quebrado em quantas linhas precisar
  doc.setFont("helvetica", "bold");
  doc.setFontSize(5);
  const rotulosClima = climaFazendas.map((g) =>
    variasFazendas ? (doc.splitTextToSize(g.fazendas.map((f) => `${f.codigo} · ${f.nome}`).join(" / "), larguraInterna) as string[]) : []
  );
  const alturaBlocoClima = (i: number) =>
    (rotulosClima[i].length ? rotulosClima[i].length * 2.4 + 0.6 : 0) + (climaFazendas[i].c?.dia ? alturaLinhaClima * 2 : 3.4) + 3;
  const alturaClima = temClima ? 4.2 + climaFazendas.reduce((s, _x, i) => s + alturaBlocoClima(i), 0) + 0.5 : 0;

  // as alturas abaixo seguem exatamente o que `desenhar` ocupa (o clima fica ancorado no rodapé e não pode cobrir o corpo)
  const alturaCabecalho = 3.4 + 3.6 + linhasFazenda.length * 3;
  const alturaEsq =
    2.4 + 3 + (nTalhoes > 0 ? 4 + linhasTalhoes.length * alturaLinhaTalhao + 3.8 + 2 : 4) + (linhasTch.length > 0 ? 0.4 + linhasTch.length * alturaLinhaTch : 0);
  const alturaDir = 1 + 9.5 + 2 + 5.5 + 2 + 11.5 + 2 + 10.5 + 2 + (ordem.tipoCana ? 3.6 : 0);
  const respiroClima = temClima ? 2.5 : 0;
  const altura = pad + alturaCabecalho + Math.max(alturaEsq, alturaDir) + respiroClima + alturaClima + pad;

  function caixa(bx: number, by: number, bw: number, bh: number, fundo: [number, number, number]) {
    doc.setFillColor(...fundo);
    doc.roundedRect(bx, by, bw, bh, 1.2, 1.2, "F");
  }

  function selo(
    texto: string,
    sx: number,
    sy: number,
    fundo: [number, number, number],
    corTexto: [number, number, number],
    alinharDireita = false,
    larguraMax?: number
  ) {
    doc.setFont("helvetica", "bold");
    let fonte = 5.4;
    doc.setFontSize(fonte);
    // texto longo (ex.: tipo de cana) encolhe até caber na largura disponível
    while (larguraMax && doc.getTextWidth(texto) + 4 > larguraMax && fonte > 4) {
      fonte -= 0.2;
      doc.setFontSize(fonte);
    }
    const w = doc.getTextWidth(texto) + 4;
    const px = alinharDireita ? sx - w : sx;
    doc.setFillColor(...fundo);
    doc.roundedRect(px, sy - 2.6, w, 3.8, 1.9, 1.9, "F");
    doc.setTextColor(...corTexto);
    doc.text(texto, px + 2, sy);
    doc.setTextColor(...INK);
    return w;
  }

  function desenhar(x: number, y: number) {
    const aberta = ordem.status === "Aberta";
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.2);
    doc.rect(x, y, largura, altura);
    doc.setFillColor(...(aberta ? STATUS_ABERTA : STATUS_ENCERRADA));
    doc.rect(x, y, faixa, altura, "F");

    const xi = x + faixa + pad;
    let cy = y + pad + 3.4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...NAVY);
    doc.text(`Ordem ${ordem.numero}`, xi, cy);
    selo(
      ordem.status,
      xi + larguraInterna,
      cy - 0.4,
      aberta ? [232, 245, 233] : [255, 243, 224],
      aberta ? STATUS_ABERTA : STATUS_ENCERRADA,
      true
    );

    cy += 3.6;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.4);
    doc.setTextColor(...MUTED);
    linhasFazenda.forEach((l, i) => doc.text(l, xi, cy + i * 3));
    cy += linhasFazenda.length * 3 - 1.5 + 1.5;

    const topoCorpo = cy;
    // ------------------------------ coluna esquerda: talhões
    let ey = topoCorpo + 2.4;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(5.4);
    doc.setTextColor(...MUTED);
    doc.text("TALHÕES", xi, ey);
    ey += 3;

    if (nTalhoes > 0) {
      const colsX = colunasCard(xi, larguraEsq);
      doc.setFillColor(...ALT_ROW);
      doc.rect(xi, ey - 2.6, larguraEsq, 4, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(5.4);
      doc.setTextColor(...MUTED);
      desenharLinhaCard(doc, colsX, ["Talhão", "Área", "D.Ant", "D.Atu", "Acum"], ey);
      ey += 4;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      doc.setTextColor(...INK);
      let seq = 0;
      linhasTalhoes.forEach((l) => {
        if ("faixa" in l) {
          doc.setFillColor(226, 232, 242);
          doc.rect(xi, ey - 2.5, larguraEsq, alturaLinhaTalhao, "F");
          doc.setFont("helvetica", "bold");
          doc.setFontSize(5.4);
          doc.setTextColor(...NAVY);
          doc.text((doc.splitTextToSize(l.faixa, larguraEsq - 2) as string[])[0], xi + 1, ey);
          doc.setFont("helvetica", "normal");
          doc.setFontSize(6);
          doc.setTextColor(...INK);
          seq = 0;
          ey += alturaLinhaTalhao;
          return;
        }
        const t = l.talhao;
        if (seq % 2 === 1) {
          doc.setFillColor(...ALT_ROW);
          doc.rect(xi, ey - 2.5, larguraEsq, alturaLinhaTalhao, "F");
        }
        seq++;
        desenharLinhaCard(
          doc,
          colsX,
          [
            t.talhao,
            fmtHa(t.areaHa),
            fmtT(calcTalhaoDiaAnterior(ordem, t, referencia)),
            fmtT(calcTalhaoDiaAtualAte6h(ordem, t, referencia)),
            fmtT(calcTalhaoEntradaPeriodo(ordem, t, "safra", referencia)),
          ],
          ey
        );
        ey += alturaLinhaTalhao;
      });

      doc.setFillColor(...NAVY);
      doc.rect(xi, ey - 2.6, larguraEsq, 3.8, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6);
      doc.setTextColor(255, 255, 255);
      desenharLinhaCard(
        doc,
        colsX,
        ["Total", fmtHa(m.areaTotalHa), fmtT(totalDiaAnteriorT), fmtT(totalDiaAtual6hT), fmtT(m.acumSafraT)],
        ey
      );
      doc.setTextColor(...INK);
      ey += 3.8 + 2;
    } else {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.4);
      doc.setTextColor(...MUTED);
      doc.text("Sem talhão cadastrado.", xi, ey);
      doc.setTextColor(...INK);
      ey += 4;
    }

    if (linhasTch.length > 0) {
      const topoTch = ey + 0.4;
      let ty = topoTch + 2.4;
      doc.setFontSize(6);
      linhasTch.forEach((l) => {
        doc.setFillColor(...l.fundo);
        doc.rect(xi, ty - 2.4, larguraEsq, alturaLinhaTch, "F");
        doc.setFont("helvetica", "normal");
        doc.setTextColor(...INK);
        doc.text(l.texto, xi + 1, ty, { maxWidth: larguraEsq - 14 });
        doc.text(l.valor, xi + larguraEsq - 1, ty, { align: "right" });
        ty += alturaLinhaTch;
      });
      doc.setDrawColor(...LINE);
      doc.rect(xi, topoTch, larguraEsq, linhasTch.length * alturaLinhaTch);
    }

    // ------------------------------ coluna direita: resumo
    const xr = xi + larguraEsq + gapColunas;
    let ry = topoCorpo + 1;
    const larguraMini = (larguraDir - 1.6) / 2;
    const FUNDO: [number, number, number] = [245, 247, 250];
    [
      ["Área da ordem", `${fmtHa(m.areaTotalHa)} ha`],
      ["Área colhida", `${fmtHa(areaColhidaHa)} ha`],
    ].forEach(([rotulo, valor], i) => {
      const bx = xr + i * (larguraMini + 1.6);
      caixa(bx, ry, larguraMini, 9.5, FUNDO);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(5.2);
      doc.setTextColor(...MUTED);
      doc.text(rotulo, bx + larguraMini - 1.8, ry + 3, { align: "right" });
      doc.setFont("helvetica", "bold");
      doc.setFontSize(7.6);
      doc.setTextColor(...INK);
      doc.text(valor, bx + larguraMini - 1.8, ry + 7.6, { align: "right" });
    });
    ry += 9.5 + 2;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.4);
    doc.setTextColor(...MUTED);
    doc.text("Progresso da colheita", xr, ry + 1.6);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...INK);
    doc.text(`${progresso}%`, xr + larguraDir, ry + 1.6, { align: "right" });
    doc.setFillColor(237, 240, 244);
    doc.roundedRect(xr, ry + 2.6, larguraDir, 1.8, 0.9, 0.9, "F");
    if (progresso > 0) {
      doc.setFillColor(31, 122, 61);
      doc.roundedRect(xr, ry + 2.6, Math.max((larguraDir * progresso) / 100, 1.8), 1.8, 0.9, 0.9, "F");
    }
    ry += 5.5 + 2;

    caixa(xr, ry, larguraDir, 11.5, [255, 255, 209]);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.4);
    doc.setTextColor(...MUTED);
    doc.text("Produção no período", xr + larguraDir - 1.8, ry + 3.4, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...INK);
    doc.text(`${fmtT(m.entradaPeriodoT)} t`, xr + larguraDir - 1.8, ry + 9, { align: "right" });
    ry += 11.5 + 2;

    caixa(xr, ry, larguraDir, 10.5, FUNDO);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(5.2);
    doc.setTextColor(...MUTED);
    doc.text("TCH médio realizado", xr + larguraDir - 1.8, ry + 3.2, { align: "right" });
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.6);
    doc.setTextColor(...INK);
    doc.text(fmtTch(tchMedio), xr + larguraDir - 1.8, ry + 8.2, { align: "right" });
    const t = tchMedio;
    const nivel: [string, [number, number, number], [number, number, number]] =
      t > 80
        ? ["Excelente", [232, 245, 233], [22, 100, 48]]
        : t >= 60
          ? ["Bom", [238, 244, 253], [23, 58, 120]]
          : t >= 40
            ? ["Médio", [255, 243, 224], [167, 110, 19]]
            : ["Baixo", [255, 235, 238], [178, 60, 43]];
    selo(nivel[0], xr + 1.8, ry + 7.6, nivel[1], nivel[2], false);
    ry += 10.5 + 2;

    if (ordem.tipoCana) {
      const queimada = ordem.tipoCana.toLowerCase().includes("queimada");
      selo(
        ordem.tipoCana.toUpperCase(),
        xr,
        ry + 2.4,
        queimada ? [255, 243, 224] : [238, 244, 253],
        queimada ? [167, 110, 19] : [23, 58, 120],
        false,
        larguraDir
      );
    }

    // ------------------------------ rodapé: clima (Zeus)
    if (temClima && clima) {
      let fy = y + altura - pad - alturaClima;
      doc.setDrawColor(...LINE);
      doc.setLineWidth(0.2);
      doc.line(x + faixa, fy, x + largura, fy);
      doc.setFillColor(...ALT_ROW);
      doc.rect(x + faixa + 0.1, fy + 0.1, largura - faixa - 0.2, alturaClima + pad - 0.2, "F");
      const ultima = climaFazendas
        .map((f) => f.c?.ultimaLeitura)
        .filter((v): v is string => !!v)
        .sort()
        .pop();
      doc.setFont("helvetica", "bold");
      doc.setFontSize(5.2);
      doc.setTextColor(...MUTED);
      doc.text("CLIMA · ZEUS", xi, fy + 3);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(5);
      doc.text(rotuloClima(clima, referencia, ultima), xi + larguraInterna, fy + 3, { align: "right" });
      fy += 4.2;

      const cw = larguraInterna / 3;
      for (const [gi, { c }] of climaFazendas.entries()) {
        if (rotulosClima[gi].length) {
          doc.setFont("helvetica", "bold");
          doc.setFontSize(5);
          doc.setTextColor(...NAVY);
          rotulosClima[gi].forEach((l, li) => doc.text(l, xi, fy + 2 + li * 2.4));
          fy += rotulosClima[gi].length * 2.4 + 0.6;
        }
        const d = c?.dia;
        if (!c || !d) {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(5.4);
          doc.setTextColor(...MUTED);
          doc.text(c ? "Sem leituras no período." : "Fazenda sem estação na Zeus.", xi, fy + 2.4);
          fy += 3.4 + 3;
          continue;
        }
        // umidade, vento, temperatura, dia anterior e chuva do dia (sem radiação)
        const itens: { icone: TipoIcone; rotulo: string; valor: string; unidade: string; destaque?: boolean }[] = itensClima(c, clima.periodo, fmtClima);
        itens.forEach((it, i) => {
          const ix = xi + (i % 3) * cw;
          const iy = fy + Math.floor(i / 3) * alturaLinhaClima;
          desenharIcone(doc, it.icone, ix + 1.8, iy + 2.6, it.destaque ? NAVY : MUTED);
          doc.setFont("helvetica", "bold");
          doc.setFontSize(6.4);
          doc.setTextColor(...INK);
          doc.text(it.valor, ix + 4.2, iy + 2.6);
          if (it.valor !== "—") {
            const wv = doc.getTextWidth(it.valor);
            doc.setFont("helvetica", "normal");
            doc.setFontSize(4.4);
            doc.setTextColor(...MUTED);
            doc.text(it.unidade, ix + 4.2 + wv + 0.5, iy + 2.6);
          }
          doc.setFont("helvetica", "normal");
          doc.setFontSize(4.4);
          doc.setTextColor(...MUTED);
          doc.text(it.rotulo, ix + 4.2, iy + 5);
        });
        fy += alturaLinhaClima * 2;
        doc.setFont("helvetica", "normal");
        doc.setFontSize(4.4);
        doc.setTextColor(...MUTED);
        doc.text(`Estação ${c.pic}`, xi, fy + 1.6);
        fy += 3;
      }
    }
    doc.setTextColor(...INK);
  }

  return { altura, desenhar };
}

/**
 * Gera o PDF completo (resumo por frente, cards de ordem em grade de 4
 * colunas — igual à tela — e resumo detalhado por ordem/fazenda com
 * gráfico) e baixa o arquivo, seguindo o padrão visual CRV Industrial.
 * Roda 100% no navegador (jsPDF), sem precisar de servidor.
 */
export async function gerarRelatorioCompletoPdf(dados: DadosRelatorioCompleto): Promise<void> {
  const { default: JsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const logoInfo = await carregarImagemInfo("/logo-crv-branca-pdf.png");

  const doc = new JsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const limiteY = pageHeight - RODAPE_ALTURA;
  const geradoEm = new Date();
  const dm = (iso: string) => fmtDateBR(iso).slice(0, 5);
  const rotuloHora = dados.horaCorte === 24 ? "00:00" : `${String(dados.horaCorte).padStart(2, "0")}:00`;

  function cabecalhoPagina(subtitulo: string) {
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, pageWidth, CABECALHO_ALTURA - 1.4, "F");
    doc.setFillColor(...GREEN);
    doc.rect(0, CABECALHO_ALTURA - 1.4, pageWidth, 1.4, "F");

    doc.setFont("helvetica", "bold");
    doc.setFontSize(12.5);
    doc.setTextColor(255, 255, 255);
    doc.text(dados.titulo, MARGEM, 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(
      `Safra ${dados.safraLabel} · Capinópolis-MG · Referência ${fmtDateBR(dados.referencia)}${
        dados.producaoDesde ? ` · Produção desde ${fmtDateBR(dados.producaoDesde)}` : ""
      } · Dia atual até ${rotuloHora}${subtitulo ? ` · ${subtitulo}` : ""}`,
      MARGEM,
      14
    );

    if (logoInfo) {
      // arquivo recortado (sem a margem transparente) e em tamanho de leitura
      const alturaLogo = 10.5;
      const larguraLogo = (logoInfo.largura / logoInfo.altura) * alturaLogo;
      doc.addImage(logoInfo.dataUrl, "PNG", pageWidth - MARGEM - larguraLogo, 2.7, larguraLogo, alturaLogo);
    }
    doc.setTextColor(...INK);
  }

  // -------------------------------------------------------------------
  // Página 1: resumo por frente (mesma tabela da tela)
  // -------------------------------------------------------------------
  cabecalhoPagina("Resumo por frente");

  // o dia atual só entra na coluna "Dia Atual": os demais períodos vão até o dia anterior
  const ontem = addDays(dados.referencia, -1);
  const semana = { inicio: startOfWeekMonday(dados.referencia), fim: ontem };
  const quinzena = { inicio: quinzenaRange(dados.referencia).inicio, fim: ontem };
  const mesAtual = { inicio: startOfMonth(dados.referencia), fim: ontem };
  const mesAnterior = mesAnteriorRange(dados.referencia);

  const cabecalhoResumo = [
    "Frente",
    "Ordens",
    "Área Sel.\n(ha)",
    "Área Acum.\n(ha)",
    "Safra\nacumulado",
    `Mês Anterior\n${dm(mesAnterior.inicio)}-${dm(mesAnterior.fim)}`,
    `Mês Atual\n${dm(mesAtual.inicio)}-${dm(mesAtual.fim)}`,
    `Quinzena\n${dm(quinzena.inicio)}-${dm(quinzena.fim)}`,
    `Semana\n${dm(semana.inicio)}-${dm(semana.fim)}`,
    `Dia Anterior\n${dm(addDays(dados.referencia, -1))}`,
    `Dia Atual\n${dm(dados.referencia)} até ${rotuloHora}`,
    "Dias\nEfet.",
    "Ton Média\nDia Efet.",
  ];

  // 8 cards do topo da tela, numa faixa só
  const ALTURA_KPI = 13.5;
  {
    const gapKpi = 2.5;
    const larguraKpi = (pageWidth - MARGEM * 2 - gapKpi * 7) / 8;
    dados.kpis.forEach((k, i) => {
      const kx = MARGEM + i * (larguraKpi + gapKpi);
      const tom = TONS_KPI[k.tom];
      doc.setFillColor(...tom.fundo);
      doc.roundedRect(kx, 22, larguraKpi, ALTURA_KPI, 1.5, 1.5, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(5.8);
      doc.setTextColor(...MUTED);
      doc.text((doc.splitTextToSize(k.label, larguraKpi - 3) as string[])[0], kx + 1.8, 25.6);
      doc.setFontSize(10);
      doc.setTextColor(...tom.texto);
      doc.text(k.value, kx + 1.8, 31);
      if (k.sub) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(5);
        doc.setTextColor(...MUTED);
        doc.text((doc.splitTextToSize(k.sub, larguraKpi - 3) as string[])[0], kx + 1.8, 34);
      }
      doc.setTextColor(...INK);
    });
  }

  const temMetas = dados.metaTotais.safra > 0 || dados.metaTotais.mesAtual > 0 || dados.metaTotais.diaAtual > 0;
  let inicioTabela = 22 + ALTURA_KPI + 3;
  if (temMetas) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.4);
    doc.setTextColor(...MUTED);
    doc.text(
      `Abaixo de cada produção: meta da frente no período (t) e % atingido. Dia Atual compara com ${
        dados.horaCorte === 24 ? "a meta diária inteira" : `${dados.horaCorte}/24 da meta diária`
      } (só até ${rotuloHora}).`,
      MARGEM,
      inicioTabela + 1.5
    );
    doc.setTextColor(...INK);
    inicioTabela += 4;
  }

  const realDoPeriodo = (r: Omit<FrenteResumo, "frente" | "meta"> & { frente?: string }) => [
    r.safraT,
    r.mesAnteriorT,
    r.mesAtualT,
    r.quinzenaT,
    r.semanaT,
    r.diaAnteriorT,
    r.diaAtualT,
  ];
  const metaDoPeriodo = (m: MetasPorPeriodo) => [m.safra, m.mesAnterior, m.mesAtual, m.quinzena, m.semana, m.diaAnterior, m.diaAtual];
  const metasLinhas: ({ real: number; meta: number } | null)[][] = [
    ...dados.resumoFrentes.map((r) => {
      const metas = metaDoPeriodo(r.meta);
      return realDoPeriodo(r).map((real, i) => (metas[i] > 0 ? { real, meta: metas[i] } : null));
    }),
    (() => {
      const metas = metaDoPeriodo(dados.metaTotais);
      return realDoPeriodo(dados.resumoTotais).map((real, i) => (metas[i] > 0 ? { real, meta: metas[i] } : null));
    })(),
  ];

  const linhaResumo = (r: FrenteResumo | (Omit<FrenteResumo, "frente" | "meta"> & { frente?: string })) => [
    r.frente ?? "Total geral",
    String(r.ordensSelecionadas),
    fmtHa(r.areaSelecionadaHa),
    fmtHa(r.areaAcumuladaHa),
    fmtT(r.safraT),
    fmtT(r.mesAnteriorT),
    fmtT(r.mesAtualT),
    fmtT(r.quinzenaT),
    fmtT(r.semanaT),
    fmtT(r.diaAnteriorT),
    fmtT(r.diaAtualT),
    String(r.diasEfetivos),
    r.diasEfetivos > 0 ? fmtT(r.mediaDiaEfetivoT) : "–",
  ];
  const md = dados.mediaDiaria;
  const linhaMedia = [
    "Média t entregue/dia (dias com entrega)",
    "",
    "",
    "",
    ...(["safra", "mesAnterior", "mesAtual", "quinzena", "semana", "diaAnterior", "diaAtual"] as const).map((k) =>
      md[k].dias > 0 ? `${fmtT(md[k].media)}\n${md[k].dias} dia(s)` : "–"
    ),
    "",
    "",
  ];

  autoTable(doc, {
    startY: inicioTabela,
    head: [cabecalhoResumo],
    body: [...dados.resumoFrentes.map(linhaResumo), linhaResumo(dados.resumoTotais), linhaMedia],
    styles: { fontSize: 7, cellPadding: 1.6 },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], halign: "right" },
    columnStyles: { 0: { halign: "left", fontStyle: "bold" }, 1: { halign: "right" } },
    didParseCell: (data) => {
      if (data.column.index > 0) data.cell.styles.halign = "right";
      if (data.section === "body") {
        // espaço embaixo da produção para a linha de meta desenhada em didDrawCell
        if (data.column.index >= 4 && metasLinhas[data.row.index]?.[data.column.index - 4]) {
          data.cell.styles.cellPadding = { top: 1.8, bottom: 4.6, left: 1.8, right: 1.8 };
        }
        if (data.row.index === dados.resumoFrentes.length) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = NAVY;
          data.cell.styles.textColor = [255, 255, 255];
        } else if (data.row.index === dados.resumoFrentes.length + 1) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = ALT_ROW;
          if (data.column.index === 0) {
            data.cell.colSpan = 4;
            data.cell.styles.halign = "left";
          }
        } else if (data.row.index % 2 === 1) {
          data.cell.styles.fillColor = ALT_ROW;
        }
      }
    },
    didDrawCell: (data) => {
      if (data.section !== "body" || data.column.index < 4) return;
      const m = metasLinhas[data.row.index]?.[data.column.index - 4];
      if (!m) return;
      const pct = (m.real / m.meta) * 100;
      const naTotal = data.row.index === dados.resumoFrentes.length;
      const xDir = data.cell.x + data.cell.width - 1.8;
      const yBase = data.cell.y + data.cell.height - 1.5;
      const txtPct = `${pct.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(5.8);
      doc.setTextColor(...(naTotal ? ([255, 255, 255] as [number, number, number]) : pct >= 100 ? BOM : pct >= 80 ? ATENCAO : ALERTA));
      doc.text(txtPct, xDir, yBase, { align: "right" });
      const larguraPct = doc.getTextWidth(txtPct);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...(naTotal ? ([255, 255, 255] as [number, number, number]) : MUTED));
      doc.text(`${fmtT(m.meta)} ·`, xDir - larguraPct - 0.8, yBase, { align: "right" });
      doc.setTextColor(...INK);
    },
    margin: { top: 22, left: MARGEM, right: MARGEM, bottom: RODAPE_ALTURA },
  });

  // -------------------------------------------------------------------
  // Cards de ordem em grade de 3 colunas, agrupados por frente — mesmo
  // conteúdo e mesmo layout dos cards da tela.
  // -------------------------------------------------------------------
  // Seguem logo abaixo do resumo por frente, na mesma página, se couber.
  let cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 6;

  function garantirEspaco(altura: number) {
    if (cursorY + altura > limiteY) {
      doc.addPage();
      cabecalhoPagina(`Ordens · ${dados.periodLabel}`);
      cursorY = 22;
    }
  }

  const GAP = 3;
  const colWidth = (pageWidth - MARGEM * 2 - GAP * 2) / 3;

  const montarCards = (grupo: OrdemCorte[]) =>
    grupo.map((ordem) =>
      montarCardOrdem(doc, ordem, dados.period, dados.referencia, colWidth, {
        historico: dados.historicoTch.porOrdem[ordem.numero],
        safraAtual: dados.historicoTch.safraAtual,
        safrasAnteriores: dados.historicoTch.safrasAnteriores,
        divergenciaPct: dados.divergenciaPorOrdem[ordem.numero],
      }, dados.clima)
    );

  for (const [frente, ordensFrente] of dados.porFrente) {
    // o título da frente nunca fica sozinho no fim da página: reserva também a 1ª linha de cards
    const cardsLinha = montarCards(ordensFrente.slice(0, 3));
    const alturaPrimeiraLinha = cardsLinha.length > 0 ? Math.max(...cardsLinha.map((c) => c.altura)) : 0;
    garantirEspaco(9.5 + alturaPrimeiraLinha + GAP);
    doc.setFillColor(...NAVY);
    doc.rect(MARGEM, cursorY, pageWidth - MARGEM * 2, 6.5, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9.5);
    doc.setFont("helvetica", "bold");
    doc.text(`${frente} — ${ordensFrente.length} ordem(ns)`, MARGEM + 2, cursorY + 4.6);
    doc.setTextColor(...INK);
    cursorY += 9.5;

    for (let i = 0; i < ordensFrente.length; i += 3) {
      const grupo = ordensFrente.slice(i, i + 3);
      const cards = i === 0 ? cardsLinha : montarCards(grupo);
      const alturaLinha = Math.max(...cards.map((c) => c.altura));
      garantirEspaco(alturaLinha + GAP);
      grupo.forEach((_, idx) => {
        const x = MARGEM + idx * (colWidth + GAP);
        cards[idx].desenhar(x, cursorY);
      });
      cursorY += alturaLinha + GAP;
    }
    cursorY += 2;
  }

  // -------------------------------------------------------------------
  // As duas tabelas finais (resumo detalhado e resumo diário do mês) são
  // sempre numa página só: cada uma é medida num PDF de rascunho e, se não
  // couber, a escala (fonte e espaçamento) diminui até caber.
  // -------------------------------------------------------------------
  type DocPdf = import("jspdf").jsPDF;
  type LastAuto = { lastAutoTable: { finalY: number } };

  function alturaDaTabela(desenhar: (d: DocPdf, escala: number, topo: number) => void, escala: number, topo: number): number {
    const rascunho = new JsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    desenhar(rascunho, escala, topo);
    if (rascunho.getNumberOfPages() > 1) return Infinity;
    return (rascunho as unknown as LastAuto).lastAutoTable.finalY - topo;
  }

  /** Maior escala (1 = tamanho normal) em que a tabela cabe no espaço disponível; null se nem a mínima couber. */
  function escolherEscala(
    desenhar: (d: DocPdf, escala: number, topo: number) => void,
    topo: number,
    disponivel: number,
    minima: number
  ): number | null {
    for (let e = 1; e >= minima - 1e-9; e -= 0.04) {
      if (alturaDaTabela(desenhar, e, topo) <= disponivel) return e;
    }
    return null;
  }

  // ---------- Resumo detalhado por ordem/fazenda ----------
  const gruposDetalhado = dados.resumoDetalhadoPorFrente;
  const nDet = (x: number | null, f: (y: number) => string) => (x !== null && x > 0 ? f(x) : "–");
  // estimado · realizado · a colher · projetado (mesmas colunas da tela)
  const fmtDetalhe = (l: TotaisResumoDetalhado, estimadoNoAColher = false) => [
    nDet(l.areaTotalHa, fmtHa),
    nDet(l.tchEst, fmtTch),
    nDet(l.tonEst, fmtT),
    nDet(l.areaColhidaHa, fmtHa),
    nDet(l.producaoTotalT, fmtT),
    nDet(l.tchRealParcial, fmtTch),
    nDet(l.areaAColherHa, fmtHa),
    `${nDet(l.tchAColher, fmtTch)}${estimadoNoAColher ? "*" : ""}`,
    nDet(l.tonAColher, fmtT),
    nDet(l.tonProjetada, fmtT),
  ];
  const BLOCOS_DETALHE: { titulo: string; cor: [number, number, number] }[] = [
    { titulo: "Estimado", cor: [26, 58, 99] },
    { titulo: "Realizado", cor: [22, 100, 48] },
    { titulo: "A colher", cor: [184, 101, 43] },
  ];

  /** Desenha as frentes `grupos` (com total geral, se pedido) em `d`, na coluna que começa em `x` com `largura`. */
  function desenharDetalhado(
    d: DocPdf,
    grupos: typeof gruposDetalhado,
    comTotalGeral: boolean,
    escala: number,
    topo: number,
    x: number,
    largura: number,
    aoNovaPagina?: () => void
  ) {
    const corpo: (string | number)[][] = [];
    const subtotais = new Set<number>();
    for (const grupo of grupos) {
      grupo.linhas.forEach((l, i) => {
        corpo.push([i === 0 ? l.frente : "", l.ordem, l.fazendaCodigo, l.fazendaNome, ...fmtDetalhe(l, l.tchAColherEstimado)]);
      });
      corpo.push([`${grupo.frente} Total`, "", "", "", ...fmtDetalhe({ ...grupo.subtotal })]);
      subtotais.add(corpo.length - 1);
    }
    if (comTotalGeral) {
      corpo.push(["Total Geral", "", "", "", ...fmtDetalhe(dados.resumoDetalhadoTotalGeral)]);
    }
    const indiceTotalGeral = comTotalGeral ? corpo.length - 1 : -1;
    const fonte = Math.max(5.2, 6.8 * escala);
    const pad = Math.max(0.45, 1.1 * escala);
    const numericas: Record<number, { halign: "right" }> = {};
    for (let c = 4; c <= 13; c++) numericas[c] = { halign: "right" };
    autoTable(d, {
      startY: topo,
      head: [
        [
          { content: "", colSpan: 4 },
          ...BLOCOS_DETALHE.map((b) => ({ content: b.titulo, colSpan: 3, styles: { halign: "center" as const, fillColor: b.cor } })),
          { content: "Projetado", styles: { halign: "center" as const, fillColor: [8, 36, 66] as [number, number, number] } },
        ],
        [
          "Frente", "Ordem", "Fazenda", "Descrição Fazenda",
          "Área Total OC (ha)", "TCH Est. (t/ha)", "Ton Est. (t)",
          "Área Colhida (ha)", "Produção Acum. (t)", "TCH Parcial (t/ha)",
          "Área a Colher (ha)", "TCH (t/ha)", "Ton (t)",
          "Ton Projetada (t)",
        ],
      ],
      body: corpo,
      styles: { fontSize: fonte, cellPadding: pad },
      headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: "bold" },
      columnStyles: numericas,
      didParseCell: (data) => {
        if (data.section === "head") {
          if (data.row.index === 1 && data.column.index >= 4) data.cell.styles.halign = "right";
          return;
        }
        if (data.section !== "body") return;
        if (data.row.index === indiceTotalGeral) {
          data.cell.styles.fillColor = NAVY;
          data.cell.styles.textColor = [255, 255, 255];
          data.cell.styles.fontStyle = "bold";
        } else if (subtotais.has(data.row.index)) {
          data.cell.styles.fillColor = [210, 219, 232];
          data.cell.styles.fontStyle = "bold";
        } else if (data.row.index % 2 === 1) {
          data.cell.styles.fillColor = ALT_ROW;
        }
      },
      margin: { top: 22, left: x, right: pageWidth - x - largura, bottom: RODAPE_ALTURA },
      didDrawPage: aoNovaPagina ? (dp) => aoNovaPagina && dp.pageNumber > 0 && aoNovaPagina() : undefined,
    });
    if (comTotalGeral) {
      const fim = (d as unknown as LastAuto).lastAutoTable.finalY;
      d.setFont("helvetica", "normal");
      d.setFontSize(Math.max(5.2, 6.2 * escala));
      d.setTextColor(100, 110, 125);
      // só caracteres da fonte padrão do PDF
      d.text(
        "A colher = area total da O.C. - area colhida (0 na ordem encerrada), pelo TCH parcial; sem TCH parcial, pelo TCH estimado (*). Ton projetada = producao acumulada + ton a colher.",
        x,
        fim + 3
      );
      d.setTextColor(...INK);
      (d as unknown as LastAuto).lastAutoTable.finalY = fim + 4;
    }
  }

  function tituloDetalhado(y: number) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...NAVY);
    doc.text("Resumo detalhado por ordem e fazenda", MARGEM, y + 3);
    doc.setTextColor(...INK);
  }

  if (gruposDetalhado.length > 0) {
    const larguraTotal = pageWidth - MARGEM * 2;
    const umaColuna = (d: DocPdf, e: number, topo: number) => desenharDetalhado(d, gruposDetalhado, true, e, topo, MARGEM, larguraTotal);
    // 1) cabe inteiro na página dos cards, no tamanho quase normal? 2) página própria;
    // 3) último recurso: segue em várias páginas
    const sobra = limiteY - cursorY - 7;
    const escalaAqui = sobra > 30 ? escolherEscala(umaColuna, cursorY + 7, sobra, 0.8) : null;
    if (escalaAqui !== null) {
      tituloDetalhado(cursorY);
      umaColuna(doc, escalaAqui, cursorY + 7);
    } else {
      doc.addPage();
      cabecalhoPagina("Resumo detalhado por ordem e fazenda");
      tituloDetalhado(22);
      const espaco = limiteY - 22 - 7 - 0.5;
      const e1 = escolherEscala(umaColuna, 29, espaco, 0.7);
      if (e1 !== null) umaColuna(doc, e1, 29);
      else {
        const paginaIni = doc.getNumberOfPages();
        desenharDetalhado(doc, gruposDetalhado, true, 0.7, 29, MARGEM, larguraTotal, () => {
          if (doc.getNumberOfPages() > paginaIni) cabecalhoPagina("Resumo detalhado por ordem e fazenda");
        });
      }
    }
  }

  // ---------- Resumo diário do mês ----------
  const rm = dados.resumoMensal;
  const tituloMensal = `Resumo diário por frente — ${rotuloMesAbrev(rm.mes)}`;
  doc.addPage();
  cabecalhoPagina(tituloMensal);
  const nFrentes = rm.frentes.length;
  const pct = (t: number, m: number) => (m > 0 ? `${Math.round((t / m) * 100)}%` : "");
  const corpoMensal: string[][] = rm.dias.map((d) => {
    const dow = new Date(`${d.data}T00:00:00Z`).getUTCDay();
    return [
      `${fmtDateBR(d.data).slice(0, 6) + d.data.slice(2, 4)} ${["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][dow]}`,
      ...rm.frentes.map((f) => (d.futuro ? "" : d.frentes[f].t > 0 ? fmtT(d.frentes[f].t) : "–")),
      d.futuro ? "" : d.totalT > 0 ? fmtT(d.totalT) : "–",
    ];
  });
  corpoMensal.push([
    "Total do mês",
    ...rm.frentes.map((f) => `${fmtT(rm.totais[f].t)}${rm.totais[f].meta > 0 ? `  (${pct(rm.totais[f].t, rm.totais[f].meta)})` : ""}`),
    `${fmtT(rm.totalT)}${rm.totalMeta > 0 ? `  (${pct(rm.totalT, rm.totalMeta)})` : ""}`,
  ]);
  const colunasMensal: Record<number, { halign: "right" }> = {};
  for (let c = 1; c <= nFrentes + 1; c++) colunasMensal[c] = { halign: "right" };
  const barraCor = (p: number): [number, number, number] => (p >= 100 ? [93, 158, 72] : p >= 80 ? [215, 123, 56] : [190, 49, 50]);

  function desenharMensal(d: DocPdf, escala: number, topo: number) {
    const fonte = Math.max(4.6, 6.5 * escala);
    const topoCel = 0.7 * escala;
    const baseCel = Math.max(1.3, 1.9 * escala);
    autoTable(d, {
      startY: topo,
      head: [["Data", ...rm.frentes, "Total (t)"]],
      body: corpoMensal,
      styles: { fontSize: fonte, cellPadding: { top: topoCel, bottom: baseCel, left: 1.6, right: 1.6 } },
      headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: "bold", cellPadding: 1.2 * escala + 0.3 },
      columnStyles: colunasMensal,
      didParseCell: (data) => {
        if (data.section !== "body") return;
        if (data.row.index === corpoMensal.length - 1) {
          data.cell.styles.fillColor = NAVY;
          data.cell.styles.textColor = [255, 255, 255];
          data.cell.styles.fontStyle = "bold";
        } else if (data.row.index % 2 === 1) {
          data.cell.styles.fillColor = ALT_ROW;
        }
      },
      // barra do alcançado sobre a meta, no pé de cada célula de frente/total
      didDrawCell: (data) => {
        if (data.section !== "body" || data.column.index === 0) return;
        const dia = rm.dias[data.row.index];
        if (!dia || dia.futuro) return;
        const col = data.column.index;
        const real = col <= nFrentes ? dia.frentes[rm.frentes[col - 1]].t : dia.totalT;
        const meta = col <= nFrentes ? dia.frentes[rm.frentes[col - 1]].meta : dia.totalMeta;
        if (!(meta > 0)) return;
        const p = (real / meta) * 100;
        // meta do dia, sem casas decimais e em cinza suave, à esquerda do valor
        d.setFont("helvetica", "normal");
        d.setFontSize(fonte);
        d.setTextColor(150, 158, 168);
        d.text(Math.round(meta).toLocaleString("pt-BR"), data.cell.x + data.cell.width * 0.28, data.cell.y + topoCel + fonte * 0.3528 * 0.85, {
          align: "right",
        });
        d.setTextColor(...INK);
        const larg = data.cell.width - 3.2;
        const y = data.cell.y + data.cell.height - (baseCel - 0.4);
        d.setFillColor(...LINE);
        d.rect(data.cell.x + 1.6, y, larg, 0.8, "F");
        d.setFillColor(...barraCor(p));
        d.rect(data.cell.x + 1.6, y, (larg * Math.min(100, p)) / 100, 0.8, "F");
      },
      margin: { top: 22, left: MARGEM, right: MARGEM, bottom: RODAPE_ALTURA },
      didDrawPage: () => {
        if (d === doc) cabecalhoPagina(tituloMensal);
      },
    });
  }
  // sempre numa página só: a escala cai até a tabela caber (31 dias + total + cabeçalho)
  desenharMensal(doc, escolherEscala(desenharMensal, 22, limiteY - 22 - 0.5, 0.45) ?? 0.45, 22);

  // -------------------------------------------------------------------
  // Rodapé em toda página: empresa/usuário/data à esquerda, título ao
  // centro, "Página X de Y" à direita.
  // -------------------------------------------------------------------
  const totalPaginas = doc.getNumberOfPages();
  for (let i = 1; i <= totalPaginas; i++) {
    doc.setPage(i);
    const y = pageHeight - 12;
    doc.setDrawColor(...LINE);
    doc.line(MARGEM, y - 4, pageWidth - MARGEM, y - 4);

    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY);
    doc.text(EMPRESA, MARGEM, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...INK);
    doc.text(`Gerado por: ${dados.nomeUsuario}`, MARGEM, y + 4);
    doc.text(geradoEm.toLocaleString("pt-BR"), MARGEM, y + 8);

    doc.text(dados.titulo, pageWidth / 2, y + 4, { align: "center" });

    doc.text(`Página ${String(i).padStart(2, "0")} de ${String(totalPaginas).padStart(2, "0")}`, pageWidth - MARGEM, y + 4, {
      align: "right",
    });
  }

  // `dataurlnewwindow` (abrir numa aba nova) depende de window.open(), que o
  // navegador silenciosamente bloqueia aqui — o import do jsPDF é
  // assíncrono, e por essa altura o clique original já não conta mais como
  // "gesto do usuário" pra maioria dos bloqueadores de pop-up. `save()`
  // baixa o arquivo direto (não é bloqueado) — o usuário abre o PDF baixado
  // pra imprimir, ou já sai imprimindo pelo próprio visualizador de PDF.
  doc.save(`${dados.titulo}_${dados.referencia.replace(/-/g, "")}.pdf`);
}
