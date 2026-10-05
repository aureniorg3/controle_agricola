import type { Emprestimo } from "./emprestimos";
import { fmtDateBR } from "./format";
import { carregarImagemInfo } from "./relatorio-pdf";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const NAVY: [number, number, number] = [35, 57, 107];
const INK: [number, number, number] = [20, 26, 36];
const MARGEM = 20;

const num = (n: number, casas = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
/** quantidade com até 3 casas, sem zeros à direita desnecessários (0,3 · 57 · 6,262) */
const qtd = (n: number) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

function dataPorExtenso(iso: string): string {
  const [a, m, d] = iso.split("-").map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

/** Comunicado de Saída de Insumo (empréstimo) no modelo padrão, em PDF (A4 retrato). */
export async function gerarComunicadoEmprestimoPdf(e: Emprestimo): Promise<void> {
  const { default: JsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const logo = await carregarImagemInfo("/logo-crv-azul-pdf.png");

  const doc = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const larg = doc.internal.pageSize.getWidth();
  const alt = doc.internal.pageSize.getHeight();
  const util = larg - MARGEM * 2;
  let y = 18;

  const espaco = (h: number) => {
    if (y + h > alt - 18) {
      doc.addPage();
      y = 20;
    }
  };
  const paragrafo = (texto: string, opts: { negrito?: boolean; tamanho?: number; justificar?: boolean; recuo?: number } = {}) => {
    doc.setFont("helvetica", opts.negrito ? "bold" : "normal");
    doc.setFontSize(opts.tamanho ?? 10);
    const linhas = doc.splitTextToSize(texto, util - (opts.recuo ?? 0)) as string[];
    espaco(linhas.length * 5);
    doc.text(linhas, MARGEM + (opts.recuo ?? 0), y, opts.justificar ? { align: "justify", maxWidth: util - (opts.recuo ?? 0) } : undefined);
    y += linhas.length * 5;
  };

  if (logo) {
    const h = 11;
    const w = (logo.largura / logo.altura) * h;
    doc.addImage(logo.dataUrl, "PNG", larg - MARGEM - w, 10, w, h);
    y = 28;
  }

  doc.setTextColor(...NAVY);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text("COMUNICADO DE SAÍDA DE INSUMO", larg / 2, y, { align: "center" });
  doc.setTextColor(...INK);
  y += 10;

  paragrafo(
    "A CRV INDUSTRIAL LTDA, inscrita no CNPJ sob o nº 03.937.452/0004-35, informa a saída do seguinte insumo, sob forma de empréstimo, conforme os dados abaixo:",
    { justificar: true }
  );
  y += 4;

  paragrafo("Destinatário:", { negrito: true });
  paragrafo(`Nome: ${e.fornCod} – ${e.fornNm}`);
  paragrafo(`Matrícula/Fornecedor: ${e.fornCod}`);
  if (e.doc) paragrafo(`${e.doc.replace(/\D/g, "").length > 11 ? "CNPJ" : "CPF"}: ${e.doc}`);
  y += 3;

  paragrafo("Insumo Emprestado:", { negrito: true });
  y += 1;
  const temDose = e.itens.some((i) => i.dose !== null);
  const cab = ["CÓDIGO", "DESCRIÇÃO", "U.M.", ...(temDose ? ["Dose"] : []), "QTD", "VL. UNIT.", "VL. TOTAL"];
  const corpo = e.itens.map((i) => [
    i.cod,
    i.nm,
    i.um,
    ...(temDose ? [i.dose !== null ? qtd(i.dose) : ""] : []),
    qtd(i.qtd),
    num(i.vu),
    num(i.vt),
  ]);
  const colTotal = cab.length - 1;
  autoTable(doc, {
    startY: y,
    head: [cab],
    body: [...corpo, [{ content: "TOTAL", colSpan: colTotal, styles: { halign: "left", fontStyle: "bold" } }, num(e.total)]],
    styles: { fontSize: 8.5, cellPadding: 1.6, lineColor: [150, 150, 150], lineWidth: 0.1, textColor: INK },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], halign: "center" },
    margin: { left: MARGEM, right: MARGEM },
    didParseCell: (d) => {
      const total = d.section === "body" && d.row.index === corpo.length;
      if (total) {
        d.cell.styles.fontStyle = "bold";
        if (d.column.index > 0) d.cell.styles.halign = "right";
      } else if (d.column.index === 2) d.cell.styles.halign = "center";
      else if (d.column.index > 2) d.cell.styles.halign = "right";
    },
  });
  y = (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY + 7;

  espaco(30);
  paragrafo("Local de Aplicação:", { negrito: true });
  for (const f of e.faz) {
    paragrafo(`Fazenda: ${f.cod}${f.nome ? ` - ${f.nome}` : ""}${f.area !== null ? `     Área: ${num(f.area)} ha` : ""}`);
  }
  if (e.vol) paragrafo(`Volume de ${e.volTipo}: ${e.vol}`);
  y += 4;

  paragrafo(
    "O insumo será utilizado exclusivamente para as atividades agrícolas desenvolvidas na propriedade citada, sendo de responsabilidade do destinatário o uso correto e conforme as normas técnicas e ambientais vigentes. Este comunicado tem por finalidade o registro formal da movimentação do item acima mencionado.",
    { justificar: true }
  );
  y += 6;
  paragrafo("Atenciosamente,");
  y += 4;

  // assinaturas: até 3 empilhadas; com 4 ou mais, em duas colunas
  const duas = e.assin.length > 3;
  const larguraCol = duas ? (util - 10) / 2 : 80;
  const alturaBloco = 16;
  for (let i = 0; i < e.assin.length; i += duas ? 2 : 1) {
    espaco(alturaBloco + 4);
    y += 10;
    for (let j = 0; j < (duas ? 2 : 1); j++) {
      const nome = e.assin[i + j];
      if (!nome) continue;
      const x = MARGEM + j * (larguraCol + 10);
      doc.setDrawColor(...INK);
      doc.line(x, y, x + larguraCol, y);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(9.5);
      doc.text(nome, x, y + 4.5);
    }
    y += 8;
  }

  const base = e.dtSol ?? e.dt ?? new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  espaco(14);
  y += 6;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Capinópolis, ${dataPorExtenso(base)}`, MARGEM, y);

  doc.save(`Comunicado de Saída de Insumo_${e.fornNm.split(" ")[0]}_${e.faz.map((f) => f.cod).join("-")}_${fmtDateBR(base).replace(/\//g, "")}.pdf`);
}
