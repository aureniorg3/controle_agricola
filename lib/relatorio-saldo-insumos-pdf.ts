import { fmtDateBR } from "./format";
import { hectaresDoSaldo, nomeEmpresa, precoMedio, textoDosagem, textoHectares, type CelSaldo, type DosagemInsumo, type MatrizSaldo } from "./insumos-saldo";
import { carregarImagemInfo } from "./relatorio-pdf";

type Cor = [number, number, number];
const NAVY: Cor = [35, 57, 107];
const GREEN: Cor = [45, 138, 90];
const ORANGE: Cor = [215, 123, 56];
const LINE: Cor = [213, 219, 225];
const INK: Cor = [20, 26, 36];
/** subtotal do grupo: cinza um tom acima da linha alternada (padrão dos relatórios) */
const SUBTOTAL: Cor = [226, 230, 235];
const MARGEM = 8;
const CABECALHO = 17.4;
const RODAPE = 14;

const nf = (n: number, c = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
const cel = (n: number, c = 2) => (Math.abs(n) < 0.0005 ? "" : nf(n, c));
const rs = (n: number) => (Math.abs(n) < 0.0005 ? "" : `R$ ${nf(n)}`);

export interface DadosRelatorioSaldo {
  dtBase: string;
  matriz: MatrizSaldo;
  separar: boolean;
  topItens: { cod: string; ds: string; valor: number }[];
  /** dosagem por hectare por código do insumo (coluna Dosagem e Hectares) */
  dosagens: Record<string, DosagemInsumo>;
  nomeUsuario: string;
  movimento: {
    datas: string[];
    lista: { emp: number; almx: number | null; valores: Record<string, number> }[];
    delta: (v: Record<string, number>, d: string) => number | null;
    totalPorData: Record<string, number>;
  };
}

/** PDF "Acompanhamento Saldo de Insumos" (A4 paisagem): matriz Grupo → Insumo por empresa, total e movimentação diária. */
export async function gerarRelatorioSaldoPdf(d: DadosRelatorioSaldo): Promise<void> {
  const { default: JsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const logo = await carregarImagemInfo("/logo-crv-branca-pdf.png");
  const doc = new JsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const larg = doc.internal.pageSize.getWidth();
  const alt = doc.internal.pageSize.getHeight();
  const geradoEm = new Date();
  const titulo = "Acompanhamento Saldo de Insumos";

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
    doc.text(`CRV Industrial · Unidade Capinópolis/MG · Saldo de Insumos Agrícolas · Data base ${fmtDateBR(d.dtBase)}`, MARGEM, 14);
    if (logo) {
      const h = 10.5;
      const w = (logo.largura / logo.altura) * h;
      doc.addImage(logo.dataUrl, "PNG", larg - MARGEM - w, 2.7, w, h);
    }
    doc.setTextColor(...INK);
  }

  const { colunas, grupos } = d.matriz;
  const tresCels = (c: CelSaldo | undefined) => (c ? [cel(c.qtd), cel(precoMedio(c)), rs(c.valor)] : ["", "", ""]);

  const cab1: { content: string; colSpan?: number; styles?: object }[] = [{ content: `Data base: ${fmtDateBR(d.dtBase)}`, colSpan: 4, styles: { halign: "left" } }];
  for (const c of colunas) cab1.push({ content: `${c.rotulo}${c.sub ? ` · ${c.sub}` : ""}`, colSpan: 3, styles: { halign: "center" } });
  cab1.push({ content: "Total", colSpan: 3, styles: { halign: "center", fillColor: ORANGE } });
  cab1.push({ content: "Aplicação", colSpan: 2, styles: { halign: "center", fillColor: GREEN } });
  const sub = ["Grupo", "Código", "Descrição do insumo", "UM"];
  for (let i = 0; i < colunas.length + 1; i++) sub.push("Qtd", "Preço médio", "Vl. total");
  sub.push("Dosagem /ha", "Hectares");

  type Tipo = "item" | "subtotal" | "total";
  const tipos: Tipo[] = [];
  const corpo: string[][] = [];
  for (const g of grupos) {
    g.itens.forEach((it, i) => {
      const dos = d.dosagens[it.cod];
      corpo.push([
        i === 0 ? g.grp.trim() : "",
        it.cod,
        it.ds,
        it.un.trim(),
        ...colunas.flatMap((c) => tresCels(it.cels[c.chave])),
        ...tresCels(it.total),
        textoDosagem(dos) || "–",
        textoHectares(hectaresDoSaldo(it.total.qtd, dos)) || "–",
      ]);
      tipos.push("item");
    });
    corpo.push([`${g.grp.trim()} · ${g.grpDs.trim()} — total`, "", "", "", ...colunas.flatMap((c) => tresCels(g.cels[c.chave])), ...tresCels(g.total), "", ""]);
    tipos.push("subtotal");
  }
  corpo.push(["Total geral", "", "", "", ...colunas.flatMap((c) => tresCels(d.matriz.cels[c.chave])), ...tresCels(d.matriz.total), "", ""]);
  tipos.push("total");

  cabecalho();
  const nCol = 4 + (colunas.length + 1) * 3 + 2;
  const colStyles: Record<number, object> = { 0: { cellWidth: 14 }, 1: { cellWidth: 15 }, 2: { cellWidth: 52 }, 3: { cellWidth: 9 } };
  for (let i = 4; i < nCol; i++) colStyles[i] = { halign: "right" };
  autoTable(doc, {
    startY: 21,
    head: [cab1 as never, sub],
    body: corpo,
    styles: { fontSize: 6.3, cellPadding: { top: 0.7, bottom: 0.7, left: 1, right: 1 }, textColor: INK, lineColor: LINE, lineWidth: 0.1 },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontSize: 6.3, halign: "right" },
    columnStyles: colStyles,
    margin: { top: 21, left: MARGEM, right: MARGEM, bottom: RODAPE + 4 },
    didParseCell: (data) => {
      if (data.section === "head") {
        if (data.row.index === 1) {
          data.cell.styles.fillColor = [236, 240, 244];
          data.cell.styles.textColor = [60, 70, 85];
        }
        if (data.column.index < 4) data.cell.styles.halign = "left";
        return;
      }
      const t = tipos[data.row.index];
      if (t === "subtotal") {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = SUBTOTAL;
        if (data.column.index === 0) data.cell.colSpan = 4;
        if (data.column.index < 4) data.cell.styles.halign = "left";
      } else if (t === "total") {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = NAVY;
        data.cell.styles.textColor = [255, 255, 255];
        if (data.column.index === 0) data.cell.colSpan = 4;
        if (data.column.index < 4) data.cell.styles.halign = "left";
      } else if (data.column.index === 0) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.textColor = NAVY;
      }
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) cabecalho();
    },
  });

  // Movimentação diária (R$) numa página própria: cabe sempre, mesmo com o resumo em várias folhas
  const mov = d.movimento;
  if (mov.datas.length > 0) {
    doc.addPage();
    cabecalho();
    doc.setFillColor(...GREEN);
    doc.rect(MARGEM, 22, larg - MARGEM * 2, 6.5, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.text("MOVIMENTAÇÃO DIÁRIA (R$) — variação do valor em estoque sobre o retrato anterior", MARGEM + 2, 26.4);
    doc.setTextColor(...INK);
    const fmtDelta = (v: number | null) => (v === null ? "–" : Math.abs(v) < 0.005 ? "0,00" : nf(v));
    const nome = (l: { emp: number; almx: number | null }) => `${nomeEmpresa(l.emp)}${l.almx !== null ? ` · ${l.almx}` : ""}`;
    autoTable(doc, {
      startY: 31,
      head: [["Empresa", ...mov.datas.map((x) => fmtDateBR(x).slice(0, 5))]],
      body: [
        ...mov.lista.map((l) => [nome(l), ...mov.datas.map((x) => fmtDelta(mov.delta(l.valores, x)))]),
        ["Total", ...mov.datas.map((x) => fmtDelta(mov.delta(mov.totalPorData, x)))],
      ],
      styles: { fontSize: 7.5, cellPadding: 1.4, textColor: INK, lineColor: LINE, lineWidth: 0.1 },
      headStyles: { fillColor: NAVY, textColor: [255, 255, 255], halign: "right" },
      columnStyles: { 0: { halign: "left", cellWidth: 40 } },
      margin: { left: MARGEM, right: MARGEM, bottom: RODAPE + 4 },
      didParseCell: (data) => {
        if (data.column.index > 0) data.cell.styles.halign = "right";
        if (data.section === "body" && data.row.index === mov.lista.length) {
          data.cell.styles.fontStyle = "bold";
          data.cell.styles.fillColor = [236, 240, 244];
        }
      },
    });
  }

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
  doc.save(`${titulo}_${d.dtBase.replace(/-/g, "")}.pdf`);
}
