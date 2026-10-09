import { fmtDateBR, fmtT } from "./format";
import { carregarImagemInfo } from "./relatorio-pdf";

const NAVY = [35, 57, 107];
const GREEN = [45, 138, 90];
const LINE = [213, 219, 225];
const ALT_ROW = [244, 246, 248];
const INK = [20, 26, 36];
const MARGEM = 10;
const CABECALHO_ALTURA = 17.4;
const RODAPE_ALTURA = 20;

const dens = (ton, v) => (v > 0 ? fmtT(ton / v) : "–");

/** PDF da entrada de cana dos terceiros, no mesmo padrão visual do relatório de Ordens de Corte. */
export async function gerarRelatorioTerceiroPdf(d) {
  const { default: JsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const logo = await carregarImagemInfo("/logo-crv-branca-pdf.png");

  const doc = new JsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
  const larg = doc.internal.pageSize.getWidth();
  const alt = doc.internal.pageSize.getHeight();
  const geradoEm = new Date();
  const titulo = "Entrada de Cana — Terceiro";

  function cabecalho() {
    doc.setFillColor(...NAVY);
    doc.rect(0, 0, larg, CABECALHO_ALTURA - 1.4, "F");
    doc.setFillColor(...GREEN);
    doc.rect(0, CABECALHO_ALTURA - 1.4, larg, 1.4, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12.5);
    doc.setTextColor(255, 255, 255);
    doc.text(titulo, MARGEM, 10);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.text(
      `${d.safraLabel ? `Safra ${d.safraLabel} · ` : ""}Capinópolis-MG · Período ${fmtDateBR(d.inicio)} a ${fmtDateBR(d.fim)}${
        d.frenteFiltro ? ` · ${d.frenteFiltro}` : ""
      }`,
      MARGEM,
      14,
    );
    if (logo) {
      const h = 10.5;
      const w = (logo.largura / logo.altura) * h;
      doc.addImage(logo.dataUrl, "PNG", larg - MARGEM - w, 2.7, w, h);
    }
    doc.setTextColor(...INK);
  }

  const corpo = [];
  const frentes = Array.from(new Set(d.linhas.map((l) => l.frente)));
  for (const f of frentes) {
    const tf = d.porFrente.find((t) => t.frente === f) ?? { ton: 0, viagens: 0 };
    corpo.push({ tipo: "frente", cels: [f || "—", fmtT(tf.ton), String(tf.viagens), dens(tf.ton, tf.viagens)] });
    const datas = Array.from(new Set(d.linhas.filter((l) => l.frente === f).map((l) => l.data)));
    for (const dt of datas) {
      const td = d.porData.find((t) => t.frente === f && t.data === dt) ?? { ton: 0, viagens: 0 };
      corpo.push({ tipo: "data", cels: [fmtDateBR(dt), fmtT(td.ton), String(td.viagens), dens(td.ton, td.viagens)] });
      for (const l of d.linhas.filter((x) => x.frente === f && x.data === dt)) {
        corpo.push({ tipo: "caminhao", cels: [`    ${l.veiculo || "—"}`, fmtT(l.ton), String(l.viagens), dens(l.ton, l.viagens)] });
      }
    }
  }
  corpo.push({ tipo: "total", cels: ["Total geral", fmtT(d.geral.ton), String(d.geral.viagens), dens(d.geral.ton, d.geral.viagens)] });

  cabecalho();
  autoTable(doc, {
    startY: 22,
    head: [["Frente / Data / Caminhão", "TON (t)", "Viagens", "Densidade\n(t/viagem)"]],
    body: corpo.map((c) => c.cels),
    styles: { fontSize: 8, cellPadding: 1.4 },
    headStyles: { fillColor: NAVY, textColor: [255, 255, 255] },
    columnStyles: { 0: { cellWidth: 80 } },
    margin: { top: 22, left: MARGEM, right: MARGEM, bottom: RODAPE_ALTURA },
    didParseCell: (data) => {
      if (data.column.index > 0) data.cell.styles.halign = "right";
      if (data.section !== "body") return;
      const tipo = corpo[data.row.index].tipo;
      if (tipo === "frente") {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [226, 230, 235]; // subtotal da frente: cinza (padrão dos relatórios)
      } else if (tipo === "data") {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = ALT_ROW;
      } else if (tipo === "total") {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = NAVY;
        data.cell.styles.textColor = [255, 255, 255];
      }
    },
    didDrawPage: (data) => {
      if (data.pageNumber > 1) cabecalho();
    },
  });

  const totalPaginas = doc.getNumberOfPages();
  for (let i = 1; i <= totalPaginas; i++) {
    doc.setPage(i);
    const y = alt - 12;
    doc.setDrawColor(...LINE);
    doc.line(MARGEM, y - 4, larg - MARGEM, y - 4);
    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY);
    doc.text("CRV Industrial", MARGEM, y);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...INK);
    doc.text(`Gerado por: ${d.nomeUsuario}`, MARGEM, y + 4);
    doc.text(geradoEm.toLocaleString("pt-BR"), MARGEM, y + 8);
    doc.text(titulo, larg / 2, y + 4, { align: "center" });
    doc.text(`Página ${String(i).padStart(2, "0")} de ${String(totalPaginas).padStart(2, "0")}`, larg - MARGEM, y + 4, { align: "right" });
  }

  doc.save(`${titulo}_${d.fim.replace(/-/g, "")}.pdf`);
}
