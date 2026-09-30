import type { FrenteResumo } from "./period";
import {
  addDays,
  calcAreaColhidaHa,
  calcOrdemMetrics,
  calcTalhaoDiaAnterior,
  calcTalhaoDiaAtualAte6h,
  calcTalhaoEntradaPeriodo,
  endOfMonth,
  mesAnteriorRange,
  quinzenaRange,
  startOfMonth,
  startOfWeekMonday,
} from "./period";
import { fmtDateBR, fmtHa, fmtT, fmtTch } from "./format";
import type { OrdemCorte, Periodo } from "./types";

const EMPRESA = "CRV Industrial";
const MARGEM = 14;
const RODAPE_ALTURA = 22;

export interface DadosRelatorioCompleto {
  titulo: string;
  safraLabel: string;
  referencia: string;
  period: Periodo;
  periodLabel: string;
  resumoFrentes: FrenteResumo[];
  resumoTotais: Omit<FrenteResumo, "frente">;
  porFrente: [string, OrdemCorte[]][];
  nomeUsuario: string;
}

/**
 * Gera o PDF completo (resumo por frente + um bloco por ordem, igual aos
 * cards da tela) e baixa o arquivo — de lá dá pra abrir e imprimir pelo
 * próprio visualizador de PDF. Roda 100% no navegador (jsPDF), sem
 * precisar de servidor.
 */
export async function gerarRelatorioCompletoPdf(dados: DadosRelatorioCompleto): Promise<void> {
  const { default: JsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new JsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const limiteY = pageHeight - RODAPE_ALTURA;
  const geradoEm = new Date();
  const dm = (iso: string) => fmtDateBR(iso).slice(0, 5);

  function cabecalhoPagina(subtitulo: string) {
    doc.setFontSize(15);
    doc.setFont("helvetica", "bold");
    doc.text(dados.titulo, MARGEM, 15);
    doc.setFontSize(10);
    doc.setFont("helvetica", "normal");
    doc.text(
      `Safra ${dados.safraLabel} · Capinópolis-MG · Referência: ${fmtDateBR(dados.referencia)}${
        subtitulo ? ` · ${subtitulo}` : ""
      }`,
      MARGEM,
      21
    );
  }

  // -------------------------------------------------------------------
  // Página 1: resumo por frente (mesma tabela da tela)
  // -------------------------------------------------------------------
  cabecalhoPagina("Resumo por frente");

  const semana = { inicio: startOfWeekMonday(dados.referencia), fim: dados.referencia };
  const quinzena = { inicio: quinzenaRange(dados.referencia).inicio, fim: dados.referencia };
  const mesAtual = { inicio: startOfMonth(dados.referencia), fim: dados.referencia };
  const mesAnterior = mesAnteriorRange(dados.referencia);
  void endOfMonth;

  const cabecalhoResumo = [
    "Frente",
    "Ordens",
    "Área (ha)",
    "Safra\nacumulado",
    `Mês Anterior\n${dm(mesAnterior.inicio)}-${dm(mesAnterior.fim)}`,
    `Mês Atual\n${dm(mesAtual.inicio)}-${dm(mesAtual.fim)}`,
    `Quinzena\n${dm(quinzena.inicio)}-${dm(quinzena.fim)}`,
    `Semana\n${dm(semana.inicio)}-${dm(semana.fim)}`,
    `Dia Anterior\n${dm(addDays(dados.referencia, -1))}`,
    `Dia Atual\n${dm(dados.referencia)} até 06h`,
  ];

  const linhaResumo = (r: FrenteResumo | (Omit<FrenteResumo, "frente"> & { frente?: string })) => [
    r.frente ?? "Total geral",
    String(r.ordens),
    fmtHa(r.areaHa),
    fmtT(r.safraT),
    fmtT(r.mesAnteriorT),
    fmtT(r.mesAtualT),
    fmtT(r.quinzenaT),
    fmtT(r.semanaT),
    fmtT(r.diaAnteriorT),
    fmtT(r.diaAtualT),
  ];

  autoTable(doc, {
    startY: 26,
    head: [cabecalhoResumo],
    body: [...dados.resumoFrentes.map(linhaResumo), linhaResumo(dados.resumoTotais)],
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [13, 33, 64], halign: "right" },
    columnStyles: { 0: { halign: "left", fontStyle: "bold" }, 1: { halign: "right" } },
    didParseCell: (data) => {
      if (data.column.index > 0) data.cell.styles.halign = "right";
      if (data.row.index === dados.resumoFrentes.length && data.section === "body") {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [243, 245, 249];
      }
    },
    margin: { bottom: RODAPE_ALTURA },
  });

  // -------------------------------------------------------------------
  // Uma ordem por bloco, agrupadas por frente — mesmo conteúdo dos cards
  // da tela (talhões, área/área colhida/acumulado, TCH, tipo de cana).
  // -------------------------------------------------------------------
  doc.addPage();
  cabecalhoPagina(`Ordens · ${dados.periodLabel}`);
  let cursorY = 26;

  function garantirEspaco(altura: number) {
    if (cursorY + altura > limiteY) {
      doc.addPage();
      cabecalhoPagina(`Ordens · ${dados.periodLabel}`);
      cursorY = 26;
    }
  }

  for (const [frente, ordens] of dados.porFrente) {
    garantirEspaco(10);
    doc.setFillColor(13, 33, 64);
    doc.rect(MARGEM, cursorY, pageWidth - MARGEM * 2, 7, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.setFont("helvetica", "bold");
    doc.text(`${frente} — ${ordens.length} ordem(ns)`, MARGEM + 2, cursorY + 5);
    doc.setTextColor(20, 26, 36);
    cursorY += 11;

    for (const ordem of ordens) {
      const m = calcOrdemMetrics(ordem, dados.period, dados.referencia);
      const areaColhidaHa = calcAreaColhidaHa(ordem);
      const fazendas = [...new Set(ordem.talhoes.map((t) => `${t.fazendaCodigo} · ${t.fazendaNome}`))];

      garantirEspaco(16);
      doc.setFontSize(10.5);
      doc.setFont("helvetica", "bold");
      doc.text(`Ordem ${ordem.numero}`, MARGEM, cursorY + 4);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8.5);
      doc.setTextColor(92, 102, 117);
      doc.text(fazendas.join("  ·  "), MARGEM + 28, cursorY + 4);

      const aberta = ordem.status === "Aberta";
      const corStatus = aberta ? ([22, 100, 48] as const) : ([167, 110, 19] as const);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(corStatus[0], corStatus[1], corStatus[2]);
      doc.text(ordem.status, pageWidth - MARGEM, cursorY + 4, { align: "right" });
      doc.setTextColor(20, 26, 36);
      cursorY += 7;

      const linhasTalhoes = ordem.talhoes.map((t) => [
        t.talhao,
        `${t.fazendaCodigo} · ${t.fazendaNome}`,
        fmtHa(t.areaHa),
        fmtT(calcTalhaoDiaAnterior(ordem, t, dados.referencia)),
        fmtT(calcTalhaoDiaAtualAte6h(ordem, t, dados.referencia)),
        fmtT(calcTalhaoEntradaPeriodo(ordem, t, "safra", dados.referencia)),
      ]);

      autoTable(doc, {
        startY: cursorY,
        head: [["Talhão", "Fazenda", "Área", "Dia Anterior", "Dia Atual", "Acum(t)"]],
        body: linhasTalhoes.length > 0 ? linhasTalhoes : [["-", "-", "-", "-", "-", "-"]],
        styles: { fontSize: 7.5, cellPadding: 1.5 },
        headStyles: { fillColor: [243, 245, 249], textColor: [92, 102, 117], fontStyle: "bold" },
        columnStyles: {
          0: { cellWidth: 20 },
          2: { halign: "right" },
          3: { halign: "right" },
          4: { halign: "right" },
          5: { halign: "right" },
        },
        margin: { left: MARGEM, right: MARGEM, bottom: RODAPE_ALTURA },
        didDrawPage: () => {
          cabecalhoPagina(`Ordens · ${dados.periodLabel}`);
        },
      });
      cursorY = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 3;

      garantirEspaco(7);
      doc.setFontSize(8.5);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(92, 102, 117);
      const resumoLinha = [
        `Área da ordem: ${fmtHa(m.areaTotalHa)} ha`,
        `Área colhida: ${fmtHa(areaColhidaHa)} ha`,
        `Acumulado safra: ${fmtT(m.acumSafraT)} t`,
        `Entrada (${dados.periodLabel}): ${fmtT(m.entradaPeriodoT)} t`,
        `TCH geral realizado: ${fmtTch(m.tchGeralRealizado)}`,
        ordem.tipoCana,
      ]
        .filter(Boolean)
        .join("   ·   ");
      doc.text(resumoLinha, MARGEM, cursorY + 3, { maxWidth: pageWidth - MARGEM * 2 });
      doc.setTextColor(20, 26, 36);
      cursorY += 9;
    }
    cursorY += 3;
  }

  // -------------------------------------------------------------------
  // Rodapé em toda página: empresa/usuário/data à esquerda, título ao
  // centro, "Página X de Y" à direita.
  // -------------------------------------------------------------------
  const totalPaginas = doc.getNumberOfPages();
  for (let i = 1; i <= totalPaginas; i++) {
    doc.setPage(i);
    const y = pageHeight - 12;
    doc.setDrawColor(200);
    doc.line(MARGEM, y - 4, pageWidth - MARGEM, y - 4);

    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(20, 26, 36);
    doc.text(EMPRESA, MARGEM, y);
    doc.setFont("helvetica", "normal");
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
