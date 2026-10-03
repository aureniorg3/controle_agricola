import { STATUS_CONFERENCIA_LABEL, type LinhaConferida } from "./conferencia";
import { fmtDateBR, fmtT } from "./format";
import { carregarImagemInfo } from "./relatorio-pdf";

const NAVY: [number, number, number] = [35, 57, 107];
const GREEN: [number, number, number] = [45, 138, 90];
const LINE: [number, number, number] = [213, 219, 225];
const ALT_ROW: [number, number, number] = [244, 246, 248];
const INK: [number, number, number] = [20, 26, 36];
const MARGEM = 10;
const TITULO = "Conferência de Pesagem";

export interface DadosRelatorioConferencia {
  linhas: LinhaConferida[];
  /** texto dos filtros aplicados, ex.: "Período 18/09/2026 a 19/09/2026 · Frente: FRENTE I" */
  filtrosTexto: string;
  nomeUsuario: string;
}

const CABECALHO = [
  "Data",
  "Equipamento",
  "Descrição",
  "Frente (Relatório)",
  "Frente (Cadastro)",
  "Fazenda",
  "Ordem",
  "Frente (Ordem)",
  "Status Ordem",
  "Toneladas (t)",
  "Status",
  "Equipamento (Correção)",
  "Frente (Correção)",
];

function linhaTabela(l: LinhaConferida): (string | number)[] {
  return [
    fmtDateBR(l.data),
    l.eqp,
    l.eqpNome,
    l.frente,
    l.frenteCadastro ?? "—",
    `${l.fazendaCodigo} - ${l.fazendaNomeExibido}`,
    l.ordemNumero ?? "—",
    l.ordemFrente ?? "—",
    l.ordemStatus ?? "—",
    fmtT(l.toneladas),
    STATUS_CONFERENCIA_LABEL[l.conferencia],
    l.frenteCorrecao ? l.eqp : "",
    l.frenteCorrecao ?? "",
  ];
}

export async function gerarConferenciaPdf(dados: DadosRelatorioConferencia): Promise<void> {
  const { jsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const logo = await carregarImagemInfo("/logo-crv-branca.png");

  const doc = new jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const largura = doc.internal.pageSize.getWidth();
  const altura = doc.internal.pageSize.getHeight();
  const geradoEm = new Date();

  const totalT = dados.linhas.reduce((s, l) => s + l.toneladas, 0);

  autoTable(doc, {
    startY: 22,
    margin: { left: MARGEM, right: MARGEM, top: 22, bottom: 20 },
    head: [CABECALHO],
    body: [
      ...dados.linhas.map(linhaTabela),
      [
        { content: "Total geral", colSpan: 9, styles: { halign: "left" } },
        { content: fmtT(totalT), styles: { halign: "right" } },
        { content: "", colSpan: 3 },
      ],
    ],
    styles: { font: "helvetica", fontSize: 7, cellPadding: 1.2, textColor: INK, lineColor: LINE, lineWidth: 0.1 },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: "bold", halign: "left" },
    alternateRowStyles: { fillColor: ALT_ROW },
    columnStyles: { 9: { halign: "right" } },
    didParseCell: (d) => {
      if (d.section === "body" && d.row.index === dados.linhas.length) {
        d.cell.styles.fillColor = NAVY;
        d.cell.styles.textColor = [255, 255, 255];
        d.cell.styles.fontStyle = "bold";
      }
    },
  });

  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, largura, 14.6, "F");
    doc.setFillColor(...GREEN);
    doc.rect(0, 14.6, largura, 1.4, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12.5);
    doc.setTextColor(255, 255, 255);
    doc.text(TITULO, MARGEM, 9);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(dados.filtrosTexto || "Todos os registros importados", MARGEM, 13);
    if (logo) {
      const h = 11.5;
      const w = (logo.largura / logo.altura) * h;
      doc.addImage(logo.dataUrl, "PNG", largura - MARGEM - w, 2, w, h);
    }

    const y = altura - 10;
    doc.setDrawColor(...LINE);
    doc.line(MARGEM, y - 4, largura - MARGEM, y - 4);
    doc.setTextColor(...INK);
    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY);
    doc.text("CRV Industrial", MARGEM, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...INK);
    doc.text(`Gerado por: ${dados.nomeUsuario} · ${geradoEm.toLocaleString("pt-BR")}`, MARGEM, y + 4);
    doc.text(TITULO, largura / 2, y + 4, { align: "center" });
    doc.text(`Página ${String(i).padStart(2, "0")} de ${String(total).padStart(2, "0")}`, largura - MARGEM, y + 4, {
      align: "right",
    });
  }

  doc.save(`${TITULO}.pdf`);
}

export async function gerarConferenciaXlsx(dados: DadosRelatorioConferencia): Promise<void> {
  const XLSX = await import("xlsx");
  const aoa: (string | number)[][] = [
    [TITULO],
    [dados.filtrosTexto || "Todos os registros importados"],
    [],
    CABECALHO,
    ...dados.linhas.map((l) => [
      fmtDateBR(l.data),
      l.eqp,
      l.eqpNome,
      l.frente,
      l.frenteCadastro ?? "",
      `${l.fazendaCodigo} - ${l.fazendaNomeExibido}`,
      l.ordemNumero ?? "",
      l.ordemFrente ?? "",
      l.ordemStatus ?? "",
      Math.round(l.toneladas * 1000) / 1000,
      STATUS_CONFERENCIA_LABEL[l.conferencia],
      l.frenteCorrecao ? l.eqp : "",
      l.frenteCorrecao ?? "",
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [10, 12, 30, 22, 22, 34, 9, 18, 12, 14, 20, 20, 20].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Conferência");
  XLSX.writeFile(wb, `${TITULO}.xlsx`);
}
