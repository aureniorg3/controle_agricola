import type { FrenteResumo } from "./period";
import { addDays, endOfMonth, mesAnteriorRange, quinzenaRange, startOfMonth, startOfWeekMonday } from "./period";
import { fmtDateBR, fmtHa, fmtT } from "./format";

const EMPRESA = "CRV Industrial";

export interface DadosRelatorioResumo {
  titulo: string;
  safraLabel: string;
  referencia: string;
  resumoFrentes: FrenteResumo[];
  resumoTotais: Omit<FrenteResumo, "frente">;
  nomeUsuario: string;
}

/**
 * Gera o PDF do resumo por frente (mesma tabela da tela) e abre numa nova
 * aba — de lá dá pra imprimir (o próprio visualizador de PDF do navegador
 * tem botão de imprimir) ou salvar o arquivo. Roda 100% no navegador
 * (jsPDF), sem precisar de servidor.
 */
export async function gerarRelatorioResumoPdf(dados: DadosRelatorioResumo): Promise<void> {
  const { default: JsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;

  const doc = new JsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const geradoEm = new Date();

  const dm = (iso: string) => fmtDateBR(iso).slice(0, 5);
  const semana = { inicio: startOfWeekMonday(dados.referencia), fim: dados.referencia };
  const quinzena = { inicio: quinzenaRange(dados.referencia).inicio, fim: dados.referencia };
  const mesAtual = { inicio: startOfMonth(dados.referencia), fim: dados.referencia };
  const mesAnterior = mesAnteriorRange(dados.referencia);
  void endOfMonth; // mantido só pra reaproveitar o import se precisar depois

  doc.setFontSize(15);
  doc.setFont("helvetica", "bold");
  doc.text(dados.titulo, 14, 15);
  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  doc.text(
    `Safra ${dados.safraLabel} · Capinópolis-MG · Referência: ${fmtDateBR(dados.referencia)}`,
    14,
    21
  );

  const cabecalho = [
    "Frente",
    "Ordens",
    "Área (ha)",
    `Safra\nacumulado`,
    `Mês Anterior\n${dm(mesAnterior.inicio)}-${dm(mesAnterior.fim)}`,
    `Mês Atual\n${dm(mesAtual.inicio)}-${dm(mesAtual.fim)}`,
    `Quinzena\n${dm(quinzena.inicio)}-${dm(quinzena.fim)}`,
    `Semana\n${dm(semana.inicio)}-${dm(semana.fim)}`,
    `Dia Anterior\n${dm(addDays(dados.referencia, -1))}`,
    `Dia Atual\n${dm(dados.referencia)} até 06h`,
  ];

  const linha = (r: FrenteResumo | (Omit<FrenteResumo, "frente"> & { frente?: string })) => [
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
    head: [cabecalho],
    body: [...dados.resumoFrentes.map(linha), linha(dados.resumoTotais)],
    styles: { fontSize: 8, cellPadding: 2 },
    headStyles: { fillColor: [13, 33, 64], halign: "right" },
    columnStyles: {
      0: { halign: "left", fontStyle: "bold" },
      1: { halign: "right" },
    },
    didParseCell: (data) => {
      if (data.column.index > 0) data.cell.styles.halign = "right";
      if (data.row.index === dados.resumoFrentes.length && data.section === "body") {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = [243, 245, 249];
      }
    },
    margin: { bottom: 22 },
  });

  const totalPaginas = doc.getNumberOfPages();
  for (let i = 1; i <= totalPaginas; i++) {
    doc.setPage(i);
    const y = pageHeight - 12;
    doc.setDrawColor(200);
    doc.line(14, y - 4, pageWidth - 14, y - 4);

    doc.setFontSize(8.5);
    doc.setFont("helvetica", "bold");
    doc.text(EMPRESA, 14, y);
    doc.setFont("helvetica", "normal");
    doc.text(`Gerado por: ${dados.nomeUsuario}`, 14, y + 4);
    doc.text(geradoEm.toLocaleString("pt-BR"), 14, y + 8);

    doc.setFont("helvetica", "normal");
    doc.text(dados.titulo, pageWidth / 2, y + 4, { align: "center" });

    doc.text(`Página ${String(i).padStart(2, "0")} de ${String(totalPaginas).padStart(2, "0")}`, pageWidth - 14, y + 4, {
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
