import { fmtDateBR, fmtT } from "./format";
import { abrirPdf, COR, pintarGrupo, pintarSubtotal, pintarTotal } from "./pdf-padrao";

const dens = (ton, v) => (v > 0 ? fmtT(ton / v) : "–");

/** PDF da entrada de cana dos terceiros (A4 retrato), no padrão dos relatórios (lib/pdf-padrao). */
export async function gerarRelatorioTerceiroPdf(d) {
  const titulo = "Entrada de Cana — Terceiro";
  const base = `${d.safraLabel ? `Safra ${d.safraLabel} · ` : ""}Capinópolis-MG · Período ${fmtDateBR(d.inicio)} a ${fmtDateBR(d.fim)}`;
  // com a frente do filtro a linha de apoio pode não caber no retrato: o cabeçalho padrão corta com "..."
  const subtitulo = d.frenteFiltro ? `${base} · ${d.frenteFiltro}` : base;
  const p = await abrirPdf({ titulo, subtitulo, dataAtualizacao: d.fim, usuario: d.nomeUsuario, orientacao: "portrait" });

  // frente (com o total dela) → data (com o total do dia) → caminhões; o zebrado dos caminhões recomeça em cada dia
  const corpo = [];
  const frentes = Array.from(new Set(d.linhas.map((l) => l.frente)));
  for (const f of frentes) {
    const tf = d.porFrente.find((t) => t.frente === f) ?? { ton: 0, viagens: 0 };
    corpo.push({ tipo: "frente", cels: [f || "—", fmtT(tf.ton), String(tf.viagens), dens(tf.ton, tf.viagens)] });
    const datas = Array.from(new Set(d.linhas.filter((l) => l.frente === f).map((l) => l.data)));
    for (const dt of datas) {
      const td = d.porData.find((t) => t.frente === f && t.data === dt) ?? { ton: 0, viagens: 0 };
      corpo.push({ tipo: "data", cels: [fmtDateBR(dt), fmtT(td.ton), String(td.viagens), dens(td.ton, td.viagens)] });
      d.linhas
        .filter((x) => x.frente === f && x.data === dt)
        .forEach((l, i) => {
          corpo.push({ tipo: "caminhao", par: i % 2 === 1, cels: [`    ${l.veiculo || "—"}`, fmtT(l.ton), String(l.viagens), dens(l.ton, l.viagens)] });
        });
    }
  }
  // Total geral no rodapé da tabela, só na última página: vai junto com a última linha e nunca fica sozinho numa folha
  const total = ["Total geral", fmtT(d.geral.ton), String(d.geral.viagens), dens(d.geral.ton, d.geral.viagens)];

  p.tabela({
    startY: p.topo,
    head: [["Frente / Data / Caminhão", "TON (t)", "Viagens", "Densidade\n(t/viagem)"]],
    body: corpo.map((c) => c.cels),
    foot: [total],
    showFoot: "lastPage",
    styles: { fontSize: 8 },
    headStyles: { fontSize: 8 },
    columnStyles: { 0: { cellWidth: 80 } },
    didParseCell: (c) => {
      c.cell.styles.halign = c.column.index > 0 ? "right" : "left";
      if (c.section === "foot") return pintarTotal(c);
      if (c.section !== "body") return;
      const linha = corpo[c.row.index];
      if (linha.tipo === "frente") pintarGrupo(c);
      else if (linha.tipo === "data") pintarSubtotal(c);
      else {
        c.cell.styles.fillColor = linha.par ? COR.alternada : COR.branco;
        if (c.column.index === 0 && linha.cels[0].trim() === "—") c.cell.styles.textColor = COR.apoio;
      }
    },
  });

  p.salvar(`${titulo}_${d.fim.replace(/-/g, "")}.pdf`);
}
