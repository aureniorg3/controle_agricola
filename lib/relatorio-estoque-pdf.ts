import { fmtDateBR } from "./format";
import { totaisEstoque, type LinhaEstoque } from "./estoque-insumos";
import { carregarImagemInfo } from "./relatorio-pdf";

type Cor = [number, number, number];
const NAVY: Cor = [35, 57, 107];
const GREEN: Cor = [45, 138, 90];
const LINE: Cor = [213, 219, 225];
const INK: Cor = [20, 26, 36];
const GRUPO: Cor = [226, 232, 242];
const MARGEM = 8;
const CABECALHO = 17.4;
const RODAPE = 14;

const nf = (n: number, c = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
const cel = (n: number | null, c = 2) => (n === null || Math.abs(n) < 0.0005 ? "–" : nf(n, c));

export interface DadosRelatorioEstoque {
  dt: string;
  dtAnterior: string | null;
  linhas: LinhaEstoque[];
  empresasTexto: string;
  gruposTexto: string;
  nomeUsuario: string;
}

/** PDF "Estoque de Insumos" (A4 paisagem), no padrão dos relatórios do sistema: produtos por grupo e total geral. */
export async function gerarRelatorioEstoquePdf(d: DadosRelatorioEstoque): Promise<void> {
  const { default: JsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const logo = await carregarImagemInfo("/logo-crv-branca-pdf.png");
  const doc = new JsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const larg = doc.internal.pageSize.getWidth();
  const alt = doc.internal.pageSize.getHeight();
  const geradoEm = new Date();
  const titulo = "Estoque de Insumos";

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
    doc.text(`CRV Industrial · Unidade Capinópolis/MG · Data do relatório ${fmtDateBR(d.dt)} · ${d.empresasTexto} · ${d.gruposTexto}`, MARGEM, 14);
    if (logo) {
      const h = 10.5;
      const w = (logo.largura / logo.altura) * h;
      doc.addImage(logo.dataUrl, "PNG", larg - MARGEM - w, 2.7, w, h);
    }
    doc.setTextColor(...INK);
  }

  type Tipo = "grupo" | "item" | "total";
  const tipos: Tipo[] = [];
  const corpo: string[][] = [];
  let grpAtual = "";
  for (const l of d.linhas) {
    if (l.grp !== grpAtual) {
      grpAtual = l.grp;
      corpo.push([`${l.grp.trim()}${l.grpDs ? ` · ${l.grpDs}` : ""}`, "", "", "", "", "", "", "", "", "", ""]);
      tipos.push("grupo");
    }
    const variacao = l.dispAnterior === null ? null : l.disp - l.dispAnterior;
    corpo.push([
      l.cod,
      l.ds,
      l.un,
      cel(l.est, 3),
      cel(l.disp, 3),
      cel(l.dif, 3),
      l.dose === null ? "–" : `${nf(l.dose, 3)}${l.doseOrigem === "dosagens" ? "*" : ""}`,
      l.vlrUnit === null ? "–" : `R$ ${nf(l.vlrUnit)}`,
      `R$ ${nf(l.vr)}`,
      cel(l.ha),
      variacao === null ? "–" : `${variacao > 0 ? "+" : ""}${cel(variacao, 3)}`,
    ]);
    tipos.push("item");
  }
  const t = totaisEstoque(d.linhas);
  corpo.push(["Total geral", "", "", nf(t.est, 3), nf(t.disp, 3), nf(t.dif, 3), "", "", `R$ ${nf(t.vr)}`, nf(t.ha), ""]);
  tipos.push("total");

  cabecalho();
  autoTable(doc, {
    startY: 21,
    head: [["Código", "Descrição", "UN", "Est. Real", "Estoque Disp.", "Dif. Real × Disp.", "Dosagem /ha", "Vlr Unit.", "Vlr Total", "Hectares", `Var. disp.${d.dtAnterior ? ` × ${fmtDateBR(d.dtAnterior).slice(0, 5)}` : ""}`]],
    body: corpo,
    styles: { fontSize: 7, cellPadding: { top: 0.9, bottom: 0.9, left: 1.2, right: 1.2 }, textColor: INK, lineColor: LINE, lineWidth: 0.1 },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontSize: 7, halign: "right" },
    columnStyles: { 0: { cellWidth: 16 }, 1: { cellWidth: 74 }, 2: { cellWidth: 10, halign: "center" } },
    margin: { top: 21, left: MARGEM, right: MARGEM, bottom: RODAPE + 4 },
    didParseCell: (data) => {
      if (data.section === "head") {
        if (data.column.index < 2) data.cell.styles.halign = "left";
        if (data.column.index === 2) data.cell.styles.halign = "center";
        return;
      }
      if (data.column.index > 2) data.cell.styles.halign = "right";
      const tipo = tipos[data.row.index];
      if (tipo === "grupo") {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = GRUPO;
        data.cell.styles.textColor = NAVY;
        if (data.column.index === 0) {
          data.cell.colSpan = 11;
          data.cell.styles.halign = "left";
        }
      } else if (tipo === "total") {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = NAVY;
        data.cell.styles.textColor = [255, 255, 255];
        if (data.column.index === 0) data.cell.colSpan = 3;
      }
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) cabecalho();
    },
  });

  const fimTabela = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 30;
  doc.setFontSize(6.8);
  doc.setTextColor(100, 110, 125);
  doc.text(
    // só caracteres da fonte padrão do PDF (sem ÷, › e −)
    "Hectares = estoque real / dosagem. Dosagem da planilha de estoque; com *, do cadastro Insumos > Dosagens (produto sem dose na planilha). Dif. = disponível - real.",
    MARGEM,
    Math.min(fimTabela + 4.5, alt - RODAPE - 2)
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
    doc.text(titulo, larg / 2, y + 1.5, { align: "center" });
    doc.text(`Página ${String(i).padStart(2, "0")} de ${String(total).padStart(2, "0")}`, larg - MARGEM, y + 1.5, { align: "right" });
  }
  doc.save(`${titulo}_${d.dt.replace(/-/g, "")}.pdf`);
}
