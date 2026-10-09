import type { DashboardAtividades, ValoresPeriodo } from "./dashboard-atividades";
import { fmtDateBR } from "./format";
import { carregarImagemInfo } from "./relatorio-pdf";

type Cor = [number, number, number];
const NAVY: Cor = [35, 57, 107];
const NAVY_ESCURO: Cor = [8, 36, 66];
const NAVY_MEDIO: Cor = [26, 58, 99];
const GREEN: Cor = [45, 138, 90];
const LINE: Cor = [213, 219, 225];
const INK: Cor = [20, 26, 36];
const MUTED: Cor = [92, 102, 117];
const ALT: Cor = [244, 246, 248];
/** subtotal: cinza um tom acima da linha alternada (padrão de todos os relatórios) */
const SUBTOTAL: Cor = [226, 230, 235];
const GRUPO: Cor = [226, 232, 242];
const DIA_REF: Cor = [220, 232, 251];
const AZUL_KPI = { fundo: [238, 244, 253] as Cor, texto: [23, 58, 120] as Cor };
const VERDE_KPI = { fundo: [232, 245, 233] as Cor, texto: [22, 100, 48] as Cor };
const MARGEM = 8;
const CABECALHO = 17.4;
const RODAPE = 14;
const DIAS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const nf = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cel = (n: number | null) => (n === null ? "" : Math.abs(n) < 0.005 ? "–" : nf(n));
const dm = (iso: string) => fmtDateBR(iso).slice(0, 5);

/** PDF do Dashboard de Atividades (A4 paisagem), no padrão dos relatórios do sistema. */
export async function gerarRelatorioDashboardAtividadesPdf(d: DashboardAtividades, nomeUsuario: string): Promise<void> {
  const { default: JsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const logo = await carregarImagemInfo("/logo-crv-branca-pdf.png");
  const doc = new JsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
  const larg = doc.internal.pageSize.getWidth();
  const alt = doc.internal.pageSize.getHeight();
  const geradoEm = new Date();
  const titulo = "Dashboard de Atividades";
  const mesRotulo = `${MESES[Number(d.dt.slice(5, 7)) - 1]}/${d.dt.slice(2, 4)}`;
  const iRef = d.semana.indexOf(d.dt);

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
    doc.text(
      `CRV Industrial · Unidade Capinópolis/MG · Data de referência ${fmtDateBR(d.dt)} · Semana ${dm(d.semana[0])} a ${dm(d.semana[6])} · Mês desde ${fmtDateBR(d.mesInicio)}`,
      MARGEM,
      14
    );
    if (logo) {
      const h = 10.5;
      const w = (logo.largura / logo.altura) * h;
      doc.addImage(logo.dataUrl, "PNG", larg - MARGEM - w, 2.7, w, h);
    }
    doc.setTextColor(...INK);
  }

  cabecalho();

  // ---------------- cards: moagem (azul) e operações (verde)
  const kpis: { rotulo: string; valor: number; un: string; tom: typeof AZUL_KPI }[] = [
    { rotulo: `Moagem do dia ${dm(d.dt)}`, valor: d.moagem.total.dias[iRef] ?? 0, un: "t", tom: AZUL_KPI },
    { rotulo: "Moagem na semana", valor: d.moagem.total.semana, un: "t", tom: AZUL_KPI },
    { rotulo: `Moagem no mês ${mesRotulo}`, valor: d.moagem.total.mes, un: "t", tom: AZUL_KPI },
    { rotulo: `Moagem na safra${d.safraMoagem ? ` ${d.safraMoagem.rotulo.replace("Safra ", "")}` : ""}`, valor: d.moagem.total.safra, un: "t", tom: AZUL_KPI },
    { rotulo: `Operações no dia ${dm(d.dt)}`, valor: d.operacoes.total.dias[iRef] ?? 0, un: "ha", tom: VERDE_KPI },
    { rotulo: "Operações na semana", valor: d.operacoes.total.semana, un: "ha", tom: VERDE_KPI },
    { rotulo: `Operações no mês ${mesRotulo}`, valor: d.operacoes.total.mes, un: "ha", tom: VERDE_KPI },
    { rotulo: `Operações na safra${d.safraOperacoes ? ` ${d.safraOperacoes.rotulo.replace("Safra ", "")}` : ""}`, valor: d.operacoes.total.safra, un: "ha", tom: VERDE_KPI },
  ];
  const gap = 2.5;
  const wk = (larg - MARGEM * 2 - gap * 7) / 8;
  const yk = 21;
  const hk = 13;
  kpis.forEach((k, i) => {
    const x = MARGEM + i * (wk + gap);
    doc.setFillColor(...k.tom.fundo);
    doc.roundedRect(x, yk, wk, hk, 1.5, 1.5, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(6.5);
    doc.setTextColor(...MUTED);
    doc.text((doc.splitTextToSize(k.rotulo, wk - 3) as string[])[0], x + 1.8, yk + 4);
    doc.setFontSize(11);
    doc.setTextColor(...k.tom.texto);
    const v = nf(k.valor);
    doc.text(v, x + 1.8, yk + 10.2);
    // a largura do valor é medida na fonte dele, antes de trocar para a da unidade
    const wv = doc.getTextWidth(v);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(k.un, x + 1.8 + wv + 1, yk + 10.2);
  });
  doc.setTextColor(...INK);

  // ---------------- tabelas (mesmo layout da tela)
  const cabecalhoTabela = (rotulo: string, safraRotulo: string) => [
    [
      { content: "", styles: { fillColor: NAVY } },
      { content: `Semana de referência · ${dm(d.semana[0])} a ${dm(d.semana[6])}`, colSpan: 7, styles: { halign: "center" as const, fillColor: NAVY_MEDIO } },
      { content: "Acumulado", colSpan: 3, styles: { halign: "center" as const, fillColor: NAVY_ESCURO } },
    ],
    // dia da semana em cima (caixa alta) e a data embaixo
    [rotulo, ...d.semana.map((s, i) => `${DIAS[i].toUpperCase()}\n${dm(s)}`), "Semana", `Mês ${mesRotulo}`, safraRotulo],
  ];
  const valores = (v: ValoresPeriodo) => [...v.dias.map(cel), cel(v.semana), cel(v.mes), cel(v.safra)];
  type Tipo = "dado" | "par" | "destaque" | "grupo" | "subtotal" | "total";

  function tabela(topo: number, tituloTabela: string, nota: string, cab: ReturnType<typeof cabecalhoTabela>, corpo: string[][], tipos: Tipo[]) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(...NAVY);
    doc.text(tituloTabela, MARGEM, topo + 3);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.8);
    doc.setTextColor(...MUTED);
    doc.text(nota, MARGEM, topo + 6.6);
    doc.setTextColor(...INK);
    autoTable(doc, {
      startY: topo + 8.5,
      head: cab,
      body: corpo,
      styles: { fontSize: 7.2, cellPadding: { top: 1, bottom: 1, left: 1.4, right: 1.4 }, textColor: INK, lineColor: LINE, lineWidth: 0.1 },
      headStyles: { fillColor: NAVY, textColor: [255, 255, 255], fontStyle: "bold", fontSize: 7, halign: "right" },
      columnStyles: { 0: { cellWidth: 74, halign: "left" } },
      didParseCell: (c) => {
        if (c.section === "head") {
          if (c.row.index === 1 && c.column.index === 0) c.cell.styles.halign = "left";
          if (c.row.index === 1 && c.column.index === iRef + 1) c.cell.styles.fillColor = [25, 118, 210];
          if (c.row.index === 1 && c.column.index > 0 && c.column.index <= 7 && d.semana[c.column.index - 1] > d.dt) c.cell.styles.textColor = [170, 185, 205];
          return;
        }
        if (c.column.index > 0) c.cell.styles.halign = "right";
        const tipo = tipos[c.row.index];
        if (tipo === "grupo") {
          c.cell.styles.fillColor = GRUPO;
          c.cell.styles.textColor = NAVY;
          c.cell.styles.fontStyle = "bold";
          if (c.column.index === 0) {
            c.cell.colSpan = 11;
            c.cell.styles.halign = "left";
          }
          return;
        }
        if (tipo === "total") {
          c.cell.styles.fillColor = NAVY_ESCURO;
          c.cell.styles.textColor = [255, 255, 255];
          c.cell.styles.fontStyle = "bold";
          return;
        }
        if (tipo === "subtotal") {
          c.cell.styles.fillColor = SUBTOTAL;
          c.cell.styles.textColor = INK;
          c.cell.styles.fontStyle = "bold";
          return;
        }
        if (tipo === "destaque") {
          c.cell.styles.fillColor = [238, 244, 253];
          c.cell.styles.textColor = NAVY;
          c.cell.styles.fontStyle = "bold";
        } else if (tipo === "par") c.cell.styles.fillColor = ALT;
        // dia de referência em destaque; a semana acumulada em negrito
        if (c.column.index === iRef + 1) {
          c.cell.styles.fillColor = DIA_REF;
          c.cell.styles.fontStyle = "bold";
        }
        if (c.column.index === 8) c.cell.styles.fontStyle = "bold";
      },
      margin: { top: 22, left: MARGEM, right: MARGEM, bottom: RODAPE + 4 },
      didDrawPage: (p) => {
        if (p.pageNumber > 1) cabecalho();
      },
    });
    return (doc as unknown as { lastAutoTable: { finalY: number } }).lastAutoTable.finalY;
  }

  // moagem: uma linha por frente e o total na última
  const corpoMoagem: string[][] = [];
  const tiposMoagem: Tipo[] = [];
  d.moagem.frentes.forEach((f, i) => {
    corpoMoagem.push([f.frente, ...valores(f)]);
    tiposMoagem.push(i % 2 ? "par" : "dado");
  });
  corpoMoagem.push(["Total moagem", ...valores(d.moagem.total)]);
  tiposMoagem.push("total");
  let y = tabela(
    yk + hk + 4,
    "Moagem · entrada de cana (t)",
    "Toneladas entregues por frente, de todas as viagens da pesagem (com ou sem ordem de corte), em dias inteiros até ontem.",
    cabecalhoTabela("Frente", d.safraMoagem?.rotulo ?? "Safra"),
    corpoMoagem,
    tiposMoagem
  );

  // operações: grupo, operações, subtotal; total geral no fim
  const corpoOps: string[][] = [];
  const tiposOps: Tipo[] = [];
  for (const g of d.operacoes.grupos) {
    corpoOps.push([g.grupo, ...Array(10).fill("")]);
    tiposOps.push("grupo");
    g.linhas.forEach((l, i) => {
      corpoOps.push([`${l.cod ? `${l.cod} · ` : ""}${l.ds}`, ...valores(l)]);
      tiposOps.push(i % 2 ? "par" : "dado");
    });
    corpoOps.push(["Subtotal", ...valores(g.subtotal)]);
    tiposOps.push("subtotal");
  }
  if (d.operacoes.grupos.length) {
    corpoOps.push(["Total geral", ...valores(d.operacoes.total)]);
    tiposOps.push("total");
  } else {
    corpoOps.push(["Sem apontamento de operação no período.", ...Array(10).fill("")]);
    tiposOps.push("dado");
  }
  // a tabela de operações começa em página nova se não couber o título e algumas linhas
  if (y + 30 > alt - RODAPE - 4) {
    doc.addPage();
    cabecalho();
    y = 18;
  }
  y = tabela(
    y + 5,
    "Operações · área realizada (ha)",
    "Área dos apontamentos diários lançados, por grupo (cadastro Grupos de Operações); nome da operação pelo cadastro Operações.",
    cabecalhoTabela("Operação", d.safraOperacoes?.rotulo ?? "Safra"),
    corpoOps,
    tiposOps
  );

  // nota
  const nota =
    `Dias fechados até ontem; os dias depois da data de referência ficam em branco. Semana, Mês e Safra acumulam até ${fmtDateBR(d.dt)}. ` +
    `Safra das operações ${d.safraOperacoes ? `desde ${fmtDateBR(d.safraOperacoes.inicio)}` : "desde 01/01"}; moagem ${
      d.safraMoagem ? `desde ${fmtDateBR(d.safraMoagem.inicio)}` : "desde 01/01"
    }.`;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.8);
  doc.setTextColor(...MUTED);
  if (y + 6 > alt - RODAPE - 2) {
    doc.addPage();
    cabecalho();
    y = 20;
  }
  doc.text(nota, MARGEM, y + 4.5, { maxWidth: larg - MARGEM * 2 });

  // rodapé em todas as páginas
  const total = doc.getNumberOfPages();
  for (let i = 1; i <= total; i++) {
    doc.setPage(i);
    const yr = alt - 8;
    doc.setDrawColor(...LINE);
    doc.line(MARGEM, yr - 4, larg - MARGEM, yr - 4);
    doc.setFontSize(7.5);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...NAVY);
    doc.text("CRV Industrial", MARGEM, yr);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...INK);
    doc.text(`Gerado por: ${nomeUsuario} · ${geradoEm.toLocaleString("pt-BR")}`, MARGEM, yr + 3.5);
    doc.text(titulo, larg / 2, yr + 1.5, { align: "center" });
    doc.text(`Página ${String(i).padStart(2, "0")} de ${String(total).padStart(2, "0")}`, larg - MARGEM, yr + 1.5, { align: "right" });
  }
  doc.save(`${titulo}_${d.dt.replace(/-/g, "")}.pdf`);
}
