import { fmtDateBR } from "./format";
import { GRUPOS_PADRAO_ESTOQUE, type LinhaEstoque } from "./estoque-insumos";
import { carregarImagemInfo } from "./relatorio-pdf";

type Cor = [number, number, number];
const NAVY: Cor = [35, 57, 107];
const GREEN: Cor = [45, 138, 90];
const LINE: Cor = [213, 219, 225];
const INK: Cor = [20, 26, 36];
const MUTED: Cor = [92, 102, 117];
const ALT: Cor = [244, 246, 248];
/** Dosagem e Disp. (ha) em destaque, como na planilha Resumo_Estoque */
const DOSAGEM: Cor = [251, 228, 213];
const HECTARES: Cor = [226, 239, 218];
const MARGEM = 8;
const CABECALHO = 17.4;
const RODAPE = 14;

const nf = (n: number, c = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });

export interface DadosRelatorioEstoque {
  dt: string;
  dtAnterior: string | null;
  linhas: LinhaEstoque[];
  empresasTexto: string;
  gruposTexto: string;
  /** grupos escolhidos na tela (só herbicidas e adjuvantes = "Estoque Herbicida") */
  grupos?: string[];
  nomeUsuario: string;
}

/**
 * PDF do estoque (A4 retrato), no modelo da planilha "Estoque Herbicida": Descrição, Código, Est Real, Estoque Disp,
 * Dif Real x Disp, Dosagem, Vlr Unit. e Disp. (ha), produto a produto, com o cabeçalho e o rodapé padrão do sistema.
 */
export async function gerarRelatorioEstoquePdf(d: DadosRelatorioEstoque): Promise<void> {
  const { default: JsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const logo = await carregarImagemInfo("/logo-crv-branca-pdf.png");
  const doc = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const larg = doc.internal.pageSize.getWidth();
  const alt = doc.internal.pageSize.getHeight();
  const geradoEm = new Date();
  const soHerbicidas =
    !!d.grupos?.length && d.grupos.every((g) => GRUPOS_PADRAO_ESTOQUE.includes(g)) && GRUPOS_PADRAO_ESTOQUE.every((g) => d.grupos!.includes(g));
  const titulo = `${soHerbicidas ? "Estoque Herbicida" : "Estoque de Insumos"} – Safra ${d.dt.slice(0, 4)}`;

  function cabecalho() {
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, larg, CABECALHO - 1.4, "F");
    doc.setFillColor(...GREEN);
    doc.rect(0, CABECALHO - 1.4, larg, 1.4, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12.5);
    doc.setTextColor(255, 255, 255);
    doc.text(titulo, MARGEM, 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(`CRV Industrial Ltda · Unidade Capinópolis-MG · Data atualização: ${fmtDateBR(d.dt)} · ${d.empresasTexto}`, MARGEM, 14);
    if (logo) {
      const h = 10.5;
      const w = (logo.largura / logo.altura) * h;
      doc.addImage(logo.dataUrl, "PNG", larg - MARGEM - w, 2.7, w, h);
    }
    doc.setTextColor(...INK);
  }

  const corpo = d.linhas.map((l) => [
    l.ds,
    l.cod,
    nf(l.est),
    nf(l.disp),
    nf(l.dif),
    l.dose === null ? "–" : `${nf(l.dose, 3)}${l.doseOrigem === "dosagens" ? "*" : ""}`,
    l.vlrUnit === null ? "–" : `R$ ${nf(l.vlrUnit)}`,
    l.ha === null ? "–" : nf(l.ha),
  ]);

  cabecalho();
  autoTable(doc, {
    startY: 21,
    head: [["Descrição", "Código", "Est Real", "Estoque Disp", "Dif Real x Disp", "Dosagem", "Vlr Unit.", "Disp. (ha)"]],
    body: corpo,
    styles: { fontSize: 8, cellPadding: { top: 1.1, bottom: 1.1, left: 1.5, right: 1.5 }, textColor: INK, lineColor: LINE, lineWidth: 0.1, valign: "middle" },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 8, halign: "center" },
    columnStyles: {
      0: { cellWidth: 62, halign: "left" },
      1: { cellWidth: 18, halign: "center" },
      2: { halign: "right" },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right", fillColor: DOSAGEM },
      6: { halign: "right", cellWidth: 24 },
      7: { halign: "right", fillColor: HECTARES, fontStyle: "bold" },
    },
    didParseCell: (c) => {
      if (c.section === "head") {
        if (c.column.index === 0) c.cell.styles.halign = "left";
        return;
      }
      if (c.row.index % 2 === 1 && c.column.index < 5) c.cell.styles.fillColor = ALT;
      // sem dosagem (ou sem estoque) não há hectares para destacar
      if (c.column.index === 7 && (d.linhas[c.row.index].ha ?? 0) <= 0) {
        c.cell.styles.fillColor = c.row.index % 2 === 1 ? ALT : [255, 255, 255];
        c.cell.styles.fontStyle = "normal";
      }
      if (c.column.index === 4 && Math.abs(d.linhas[c.row.index].dif) >= 0.005) {
        c.cell.styles.textColor = [178, 60, 43];
        c.cell.styles.fontStyle = "bold";
      }
    },
    margin: { top: 21, left: MARGEM, right: MARGEM, bottom: RODAPE + 4 },
    didDrawPage: (p) => {
      if (p.pageNumber > 1) cabecalho();
    },
  });

  const fim = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 30;
  doc.setFontSize(6.8);
  doc.setTextColor(...MUTED);
  doc.text(
    // só caracteres da fonte padrão do PDF (sem ÷, › e −)
    [
      "Disp. (ha) = estoque real / dosagem por hectare. Dif Real x Disp = estoque disponível - estoque real (em vermelho quando há diferença).",
      `Dosagem da planilha de estoque; com *, do cadastro Insumos > Dosagens. ${d.gruposTexto}.`,
    ],
    MARGEM,
    Math.min(fim + 4.5, alt - RODAPE - 5)
  );

  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    const y = alt - 8;
    doc.setDrawColor(...LINE);
    doc.line(MARGEM, y - 4, larg - MARGEM, y - 4);
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY);
    doc.text("CRV Industrial", MARGEM, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...INK);
    doc.text(`Gerado por: ${d.nomeUsuario} · ${geradoEm.toLocaleString("pt-BR")}`, MARGEM, y + 3.5);
    doc.text(soHerbicidas ? "Estoque Herbicida" : "Estoque de Insumos", larg / 2, y + 1.5, { align: "center" });
    doc.text(`Página ${String(i).padStart(2, "0")} de ${String(total).padStart(2, "0")}`, larg - MARGEM, y + 1.5, { align: "right" });
  }
  doc.save(`${soHerbicidas ? "Estoque Herbicida" : "Estoque de Insumos"}_${d.dt.replace(/-/g, "")}.pdf`);
}
