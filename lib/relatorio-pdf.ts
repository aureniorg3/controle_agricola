import type { FrenteResumo, LinhaResumoDetalhado } from "./period";
import {
  addDays,
  calcAreaColhidaHa,
  calcOrdemMetrics,
  calcTalhaoDiaAnterior,
  calcTalhaoDiaAtualAte6h,
  calcTalhaoEntradaPeriodo,
  mesAnteriorRange,
  quinzenaRange,
  startOfMonth,
  startOfWeekMonday,
} from "./period";
import { fmtDateBR, fmtHa, fmtT, fmtTch } from "./format";
import type { OrdemCorte, Periodo } from "./types";

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

export interface ResumoDetalhadoFrente {
  frente: string;
  linhas: LinhaResumoDetalhado[];
  subtotal: { areaColhidaHa: number; producaoTotalT: number; tchRealParcial: number };
}

export interface DadosRelatorioCompleto {
  titulo: string;
  safraLabel: string;
  referencia: string;
  period: Periodo;
  periodLabel: string;
  resumoFrentes: FrenteResumo[];
  resumoTotais: Omit<FrenteResumo, "frente" | "meta">;
  porFrente: [string, OrdemCorte[]][];
  resumoDetalhadoPorFrente: ResumoDetalhadoFrente[];
  resumoDetalhadoTotalGeral: { areaColhidaHa: number; producaoTotalT: number; tchRealParcial: number };
  nomeUsuario: string;
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
    { x: xStart, align: "left" as const },
    { x: xStart + wTalhao + wResto, align: "right" as const },
    { x: xStart + wTalhao + wResto * 2, align: "right" as const },
    { x: xStart + wTalhao + wResto * 3, align: "right" as const },
    { x: xStart + wTalhao + wResto * 4, align: "right" as const },
  ];
}

function desenharLinhaCard(
  doc: import("jspdf").jsPDF,
  cols: { x: number; align: "left" | "right" }[],
  valores: (string | number)[],
  y: number
) {
  valores.forEach((v, i) => doc.text(String(v), cols[i].x, y, { align: cols[i].align }));
}

function desenharGraficoBarras(
  doc: import("jspdf").jsPDF,
  dados: { label: string; valor: number }[],
  x: number,
  y: number,
  largura: number
) {
  const max = Math.max(1, ...dados.map((d) => d.valor));
  const alturaLinha = 6;
  const colunaLabel = 46;
  const colunaValor = 26;
  const larguraBarraMax = largura - colunaLabel - colunaValor - 4;
  dados.forEach((d, i) => {
    const ly = y + i * alturaLinha;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(...INK);
    doc.text(d.label, x, ly + 3.8, { maxWidth: colunaLabel - 2 });
    const larguraBarra = Math.max((d.valor / max) * larguraBarraMax, 0.5);
    doc.setFillColor(...NAVY);
    doc.rect(x + colunaLabel, ly, larguraBarra, 4.2, "F");
    doc.setFont("helvetica", "bold");
    doc.text(`${fmtT(d.valor)} t`, x + colunaLabel + larguraBarra + 2, ly + 3.4);
  });
}

/**
 * Monta (mede, mas não desenha) um card de ordem — mesmo conteúdo do card da
 * tela: talhões com área/dia anterior/dia atual/acumulado, linha de total e
 * resumo (área/área colhida/TCH). Devolve a altura exata que vai ocupar e
 * uma função `desenhar(x, y)` pra posicionar no grid de 4 colunas.
 */
function montarCardOrdem(
  doc: import("jspdf").jsPDF,
  ordem: OrdemCorte,
  period: Periodo,
  referencia: string,
  largura: number
): { altura: number; desenhar: (x: number, y: number) => void } {
  const pad = 2.2;
  const larguraUtil = largura - pad * 2;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.6);
  const fazendas = [...new Set(ordem.talhoes.map((t) => `${t.fazendaCodigo} · ${t.fazendaNome}`))].join("   ");
  const linhasFazenda = doc.splitTextToSize(fazendas || "Sem talhão cadastrado", larguraUtil) as string[];

  const m = calcOrdemMetrics(ordem, period, referencia);
  const areaColhidaHa = calcAreaColhidaHa(ordem);
  const diaAnteriorIso = addDays(referencia, -1);
  const totalDiaAnteriorT = round2(
    ordem.entradas.filter((e) => e.data === diaAnteriorIso).reduce((s, e) => s + e.toneladas, 0)
  );
  const totalDiaAtual6hT = round2(
    ordem.entradas.filter((e) => e.data === referencia).reduce((s, e) => s + e.toneladasAte6h, 0)
  );

  const linhaResumo1 = `Área: ${fmtHa(m.areaTotalHa)} ha   ·   Colhida: ${fmtHa(areaColhidaHa)} ha`;
  const linhaResumo2 = `TCH: ${fmtTch(m.tchGeralRealizado)}   ·   ${ordem.tipoCana || "-"}`;

  const nTalhoes = ordem.talhoes.length;
  const alturaTitulo = 3.3;
  const alturaFazenda = linhasFazenda.length * 3.1;
  const alturaTabCabecalho = nTalhoes > 0 ? 4 : 0;
  const alturaLinhaTalhao = 3.3;
  const alturaTabela = nTalhoes * alturaLinhaTalhao;
  const alturaTotalRow = nTalhoes > 0 ? 3.8 : 0;
  const alturaSemTalhao = nTalhoes === 0 ? 3.6 : 0;
  const alturaResumo = 7;
  const altura =
    pad * 2 +
    alturaTitulo +
    alturaFazenda +
    1 +
    alturaTabCabecalho +
    alturaTabela +
    alturaTotalRow +
    alturaSemTalhao +
    1.5 +
    alturaResumo;

  function desenhar(x: number, y: number) {
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.2);
    doc.rect(x, y, largura, altura);

    let cy = y + pad + 3;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.2);
    doc.setTextColor(...NAVY);
    doc.text(`Ordem ${ordem.numero}`, x + pad, cy);
    const aberta = ordem.status === "Aberta";
    doc.setFontSize(6.6);
    doc.setTextColor(...(aberta ? STATUS_ABERTA : STATUS_ENCERRADA));
    doc.text(ordem.status, x + largura - pad, cy, { align: "right" });
    doc.setTextColor(...INK);

    cy += alturaTitulo;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.6);
    doc.setTextColor(...MUTED);
    linhasFazenda.forEach((l, i) => doc.text(l, x + pad, cy + i * 3.1));
    cy += alturaFazenda + 1;

    if (nTalhoes > 0) {
      const colsX = colunasCard(x + pad, larguraUtil);

      doc.setFillColor(...ALT_ROW);
      doc.rect(x + pad, cy - 2.6, larguraUtil, alturaTabCabecalho, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(5.6);
      doc.setTextColor(...MUTED);
      desenharLinhaCard(doc, colsX, ["Talhão", "Área", "D.Ant", "D.Atu", "Acum"], cy);
      cy += alturaTabCabecalho;

      doc.setFont("helvetica", "normal");
      doc.setFontSize(6);
      doc.setTextColor(...INK);
      ordem.talhoes.forEach((t, i) => {
        if (i % 2 === 1) {
          doc.setFillColor(...ALT_ROW);
          doc.rect(x + pad, cy - 2.5, larguraUtil, alturaLinhaTalhao, "F");
        }
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
          cy
        );
        cy += alturaLinhaTalhao;
      });

      doc.setFillColor(...NAVY);
      doc.rect(x + pad, cy - 2.6, larguraUtil, alturaTotalRow, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(6);
      doc.setTextColor(255, 255, 255);
      desenharLinhaCard(
        doc,
        colsX,
        ["Total", fmtHa(m.areaTotalHa), fmtT(totalDiaAnteriorT), fmtT(totalDiaAtual6hT), fmtT(m.acumSafraT)],
        cy
      );
      doc.setTextColor(...INK);
      cy += alturaTotalRow + 1.5;
    } else {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.4);
      doc.setTextColor(...MUTED);
      doc.text("Sem talhão cadastrado.", x + pad, cy);
      doc.setTextColor(...INK);
      cy += alturaSemTalhao + 1.5;
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.4);
    doc.setTextColor(...MUTED);
    doc.text(linhaResumo1, x + pad, cy);
    doc.text(linhaResumo2, x + pad, cy + 3.4);
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

  const logoInfo = await carregarImagemInfo("/logo-crv-branca.png");

  const doc = new JsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const limiteY = pageHeight - RODAPE_ALTURA;
  const geradoEm = new Date();
  const dm = (iso: string) => fmtDateBR(iso).slice(0, 5);

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
        subtitulo ? ` · ${subtitulo}` : ""
      }`,
      MARGEM,
      14
    );

    if (logoInfo) {
      const alturaLogo = 7;
      const larguraLogo = (logoInfo.largura / logoInfo.altura) * alturaLogo;
      doc.addImage(logoInfo.dataUrl, "PNG", pageWidth - MARGEM - larguraLogo, 4.8, larguraLogo, alturaLogo);
    }
    doc.setTextColor(...INK);
  }

  // -------------------------------------------------------------------
  // Página 1: resumo por frente (mesma tabela da tela)
  // -------------------------------------------------------------------
  cabecalhoPagina("Resumo por frente");

  const semana = { inicio: startOfWeekMonday(dados.referencia), fim: dados.referencia };
  const quinzena = { inicio: quinzenaRange(dados.referencia).inicio, fim: dados.referencia };
  const mesAtual = { inicio: startOfMonth(dados.referencia), fim: dados.referencia };
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
    `Dia Atual\n${dm(dados.referencia)} até 06h`,
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
  ];

  autoTable(doc, {
    startY: 22,
    head: [cabecalhoResumo],
    body: [...dados.resumoFrentes.map(linhaResumo), linhaResumo(dados.resumoTotais)],
    styles: { fontSize: 7.5, cellPadding: 1.8 },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], halign: "right" },
    columnStyles: { 0: { halign: "left", fontStyle: "bold" }, 1: { halign: "right" } },
    didParseCell: (data) => {
      if (data.column.index > 0) data.cell.styles.halign = "right";
      if (data.section === "body") {
        if (data.row.index === dados.resumoFrentes.length) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = NAVY;
          data.cell.styles.textColor = [255, 255, 255];
        } else if (data.row.index % 2 === 1) {
          data.cell.styles.fillColor = ALT_ROW;
        }
      }
    },
    margin: { top: 22, left: MARGEM, right: MARGEM, bottom: RODAPE_ALTURA },
  });

  // -------------------------------------------------------------------
  // Cards de ordem em grade de 4 colunas, agrupados por frente — mesmo
  // conteúdo e mesmo layout dos cards da tela.
  // -------------------------------------------------------------------
  doc.addPage();
  cabecalhoPagina(`Ordens · ${dados.periodLabel}`);
  let cursorY = 22;

  function garantirEspaco(altura: number) {
    if (cursorY + altura > limiteY) {
      doc.addPage();
      cabecalhoPagina(`Ordens · ${dados.periodLabel}`);
      cursorY = 22;
    }
  }

  const GAP = 3;
  const colWidth = (pageWidth - MARGEM * 2 - GAP * 3) / 4;

  for (const [frente, ordensFrente] of dados.porFrente) {
    garantirEspaco(9);
    doc.setFillColor(...NAVY);
    doc.rect(MARGEM, cursorY, pageWidth - MARGEM * 2, 6.5, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(9.5);
    doc.setFont("helvetica", "bold");
    doc.text(`${frente} — ${ordensFrente.length} ordem(ns)`, MARGEM + 2, cursorY + 4.6);
    doc.setTextColor(...INK);
    cursorY += 9.5;

    for (let i = 0; i < ordensFrente.length; i += 4) {
      const grupo = ordensFrente.slice(i, i + 4);
      const cards = grupo.map((ordem) => montarCardOrdem(doc, ordem, dados.period, dados.referencia, colWidth));
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
  // Resumo detalhado por ordem/fazenda (uma linha por fazenda, subtotal
  // por frente e total geral) + gráfico de barras de produção por frente.
  // -------------------------------------------------------------------
  doc.addPage();
  cabecalhoPagina("Resumo detalhado por ordem e fazenda");
  cursorY = 22;

  const corpoDetalhado: (string | number)[][] = [];
  const linhasSubtotal = new Set<number>();
  for (const grupo of dados.resumoDetalhadoPorFrente) {
    grupo.linhas.forEach((l, i) => {
      corpoDetalhado.push([
        i === 0 ? l.frente : "",
        l.ordem,
        l.fazendaCodigo,
        l.fazendaNome,
        l.areaColhidaHa > 0 ? fmtHa(l.areaColhidaHa) : "–",
        l.producaoTotalT > 0 ? fmtT(l.producaoTotalT) : "–",
        l.tchRealParcial > 0 ? fmtTch(l.tchRealParcial) : "–",
      ]);
    });
    corpoDetalhado.push([
      `${grupo.frente} Total`,
      "",
      "",
      "",
      fmtHa(grupo.subtotal.areaColhidaHa),
      fmtT(grupo.subtotal.producaoTotalT),
      fmtTch(grupo.subtotal.tchRealParcial),
    ]);
    linhasSubtotal.add(corpoDetalhado.length - 1);
  }
  corpoDetalhado.push([
    "Total Geral",
    "",
    "",
    "",
    fmtHa(dados.resumoDetalhadoTotalGeral.areaColhidaHa),
    fmtT(dados.resumoDetalhadoTotalGeral.producaoTotalT),
    fmtTch(dados.resumoDetalhadoTotalGeral.tchRealParcial),
  ]);
  const indiceTotalGeral = corpoDetalhado.length - 1;

  autoTable(doc, {
    startY: cursorY,
    head: [["Frente", "Ordem", "Fazenda", "Fundo Agrícola", "Área(ha) Colhida", "Prod.(t) Total Real. Até Hoje", "TCH(t/ha) Real. Parcial"]],
    body: corpoDetalhado,
    styles: { fontSize: 7.5, cellPadding: 1.8 },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: "bold" },
    columnStyles: { 4: { halign: "right" }, 5: { halign: "right" }, 6: { halign: "right" } },
    didParseCell: (data) => {
      if (data.section !== "body") return;
      if (data.row.index === indiceTotalGeral) {
        data.cell.styles.fillColor = NAVY;
        data.cell.styles.textColor = [255, 255, 255];
        data.cell.styles.fontStyle = "bold";
      } else if (linhasSubtotal.has(data.row.index)) {
        data.cell.styles.fillColor = [210, 219, 232];
        data.cell.styles.fontStyle = "bold";
      } else if (data.row.index % 2 === 1) {
        data.cell.styles.fillColor = ALT_ROW;
      }
    },
    margin: { top: 22, left: MARGEM, right: MARGEM, bottom: RODAPE_ALTURA },
    didDrawPage: () => cabecalhoPagina("Resumo detalhado por ordem e fazenda"),
  });
  cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 8;

  const dadosGrafico = dados.resumoDetalhadoPorFrente.map((g) => ({
    label: g.frente,
    valor: g.subtotal.producaoTotalT,
  }));
  if (dadosGrafico.length > 0) {
    const alturaGrafico = dadosGrafico.length * 6;
    garantirEspaco(10 + alturaGrafico);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...NAVY);
    doc.text("Produção Total (t) por Frente", MARGEM, cursorY);
    doc.setTextColor(...INK);
    cursorY += 5;
    desenharGraficoBarras(doc, dadosGrafico, MARGEM, cursorY, pageWidth - MARGEM * 2);
    cursorY += alturaGrafico;
  }

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
  doc.save(`${dados.titulo}.pdf`);
}
