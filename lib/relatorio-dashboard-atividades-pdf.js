import { fmtDateBR } from "./format";
import { abrirPdf, COR, pintarGrupo, pintarSubcabecalho, pintarSubtotal, pintarTotal, separarBlocosCabecalho } from "./pdf-padrao";

/** Dias depois da data de referência no cabeçalho: branco apagado sobre o azul (como na tela). */
const CAB_APAGADO = COR.azul.map((c) => Math.round(c * 0.55 + 255 * 0.45));
const DIAS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

const nf = (n) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cel = (n) => (n === null ? "" : Math.abs(n) < 0.005 ? "–" : nf(n));
const dm = (iso) => fmtDateBR(iso).slice(0, 5);

/** PDF do Dashboard de Atividades (A4 paisagem), no padrão dos relatórios do sistema (lib/pdf-padrao). */
export async function gerarRelatorioDashboardAtividadesPdf(d, nomeUsuario) {
  const titulo = "Dashboard de Atividades";
  const mesRotulo = `${MESES[Number(d.dt.slice(5, 7)) - 1]}/${d.dt.slice(2, 4)}`;
  const iRef = d.semana.indexOf(d.dt);
  const p = await abrirPdf({
    titulo,
    subtitulo: `CRV Industrial · Unidade Capinópolis/MG · Data de referência ${fmtDateBR(d.dt)} · Semana ${dm(d.semana[0])} a ${dm(d.semana[6])} · Mês desde ${fmtDateBR(d.mesInicio)}`,
    dataAtualizacao: d.dt,
    usuario: nomeUsuario,
  });

  // ---------------- indicadores: moagem (azul) na 1ª linha e operações (verde) na 2ª, como na tela
  let y = p.indicadores(
    p.topo,
    [
      { rotulo: `Moagem do dia ${dm(d.dt)}`, valor: nf(d.moagem.total.dias[iRef] ?? 0), unidade: "t", cor: "azul" },
      { rotulo: "Moagem na semana", valor: nf(d.moagem.total.semana), unidade: "t", cor: "azul" },
      { rotulo: `Moagem no mês ${mesRotulo}`, valor: nf(d.moagem.total.mes), unidade: "t", cor: "azul" },
      {
        rotulo: `Moagem na safra${d.safraMoagem ? ` ${d.safraMoagem.rotulo.replace("Safra ", "")}` : ""}`,
        valor: nf(d.moagem.total.safra),
        unidade: "t",
        cor: "azul",
      },
      { rotulo: `Operações no dia ${dm(d.dt)}`, valor: nf(d.operacoes.total.dias[iRef] ?? 0), unidade: "ha", cor: "verde" },
      { rotulo: "Operações na semana", valor: nf(d.operacoes.total.semana), unidade: "ha", cor: "verde" },
      { rotulo: `Operações no mês ${mesRotulo}`, valor: nf(d.operacoes.total.mes), unidade: "ha", cor: "verde" },
      {
        rotulo: `Operações na safra${d.safraOperacoes ? ` ${d.safraOperacoes.rotulo.replace("Safra ", "")}` : ""}`,
        valor: nf(d.operacoes.total.safra),
        unidade: "ha",
        cor: "verde",
      },
    ],
    { colunas: 4, altura: 13 },
  );

  // ---------------- tabelas (mesmo layout da tela): rótulo | semana de referência dia a dia | acumulado
  const cabecalhoTabela = (rotulo, safraRotulo) => [
    [
      { content: rotulo, rowSpan: 2, styles: { halign: "left" } },
      { content: `Semana de referência · ${dm(d.semana[0])} a ${dm(d.semana[6])}`, colSpan: 7, styles: { halign: "center" } },
      { content: "Acumulado", colSpan: 3, styles: { halign: "center" } },
    ],
    // dia da semana em cima (caixa alta) e a data embaixo
    [...d.semana.map((s, i) => `${DIAS[i].toUpperCase()}\n${dm(s)}`), "Semana", `Mês ${mesRotulo}`, safraRotulo],
  ];
  const valores = (v) => [...v.dias.map(cel), cel(v.semana), cel(v.mes), cel(v.safra)];

  function tabela(yIni, tituloTabela, nota, cab, corpo, tipos) {
    // linhas que não ficam separadas da seguinte por uma quebra de página: o título do grupo (fica com a 1ª operação)
    // e a última linha antes do subtotal ou do total (o subtotal/total não começa a página sozinho)
    const juntaComProxima = (i) => tipos[i] === "grupo" || tipos[i + 1] === "subtotal" || tipos[i + 1] === "total";
    // título da seção, cabeçalho da tabela e o 1º bloco de linhas (ao menos 2; ex.: o grupo e a 1ª operação) na mesma
    // página; se não couberem, começa em página nova (senão o título e o cabeçalho podiam ficar sozinhos no pé da página)
    let primeiras = 1;
    while (juntaComProxima(primeiras - 1) && primeiras < tipos.length) primeiras++;
    const yLivre = p.espaco(yIni, 30 + 5.6 * Math.max(2, primeiras));
    // no alto de uma página nova a seção fica na linha padrão; no meio da página, 4 mm abaixo do bloco anterior
    const yt = p.secao(yLivre === p.topo ? yLivre : yLivre + 4, tituloTabela, nota);
    return p.tabela({
      startY: yt + 1,
      head: cab,
      body: corpo,
      // nenhuma linha partida entre duas páginas (nome de operação longo ocupa 2 linhas)
      rowPageBreak: "avoid",
      headStyles: { halign: "right" },
      columnStyles: { 0: { cellWidth: 74, halign: "left" } },
      didParseCell: (c) => {
        if (c.section === "head") {
          // linha dos blocos (Semana de referência / Acumulado) no azul mais escuro
          if (c.row.index === 0 && c.column.index > 0) return pintarSubcabecalho(c);
          if (c.row.index === 1 && c.column.index === iRef + 1) c.cell.styles.fillColor = COR.grupoTexto;
          if (c.row.index === 1 && c.column.index > 0 && c.column.index <= 7 && d.semana[c.column.index - 1] > d.dt) c.cell.styles.textColor = CAB_APAGADO;
          return;
        }
        if (c.column.index > 0) c.cell.styles.halign = "right";
        const tipo = tipos[c.row.index];
        if (tipo === "grupo") {
          pintarGrupo(c);
          c.cell.styles.halign = "left";
          return;
        }
        if (tipo === "total") return pintarTotal(c);
        if (tipo === "subtotal") return pintarSubtotal(c);
        // zebra recomeça em cada grupo (como na tela)
        c.cell.styles.fillColor = tipo === "par" ? COR.alternada : COR.branco;
        // dia de referência em destaque; a semana acumulada em negrito
        if (c.column.index === iRef + 1) {
          c.cell.styles.fillColor = COR.grupoFundo;
          c.cell.styles.fontStyle = "bold";
        }
        if (c.column.index === 8) c.cell.styles.fontStyle = "bold";
      },
      willDrawCell: (c) => {
        // linha levada para a página seguinte (ver didDrawCell): volta à altura real antes de ser desenhada
        if (c.section === "body") c.cell.height = c.row.height;
      },
      didDrawCell: (c) => {
        if (c.section === "body") {
          // depois desta linha: se a próxima cabe na página, mas não o bloco que ela forma com as seguintes (título do
          // grupo + 1ª operação; última linha + subtotal/total), ela vai para a página seguinte; a altura dela cresce
          // só para não caber aqui. Se esta linha já forma bloco com a próxima, não separa (ela ficaria sozinha).
          const linhas = c.table.body;
          const i = c.row.index + 1;
          if (c.column.index !== 0 || !linhas[i] || juntaComProxima(c.row.index)) return;
          let bloco = linhas[i].height;
          for (let k = i; juntaComProxima(k) && linhas[k + 1]; k++) bloco += linhas[k + 1].height;
          const livre = c.doc.internal.pageSize.getHeight() - c.settings.margin.bottom - (c.cell.y + c.row.height);
          if (linhas[i].height <= livre && bloco > livre) linhas[i].cells[0].height = livre + 1;
          return;
        }
        // traço entre os blocos no cabeçalho: antes do 1º dia e antes do acumulado
        separarBlocosCabecalho(c, [1, 8]);
      },
    });
  }

  // moagem: uma linha por frente e o total na última
  const corpoMoagem = [];
  const tiposMoagem = [];
  d.moagem.frentes.forEach((f, i) => {
    corpoMoagem.push([f.frente, ...valores(f)]);
    tiposMoagem.push(i % 2 ? "par" : "dado");
  });
  corpoMoagem.push(["Total moagem", ...valores(d.moagem.total)]);
  tiposMoagem.push("total");
  y = tabela(
    y,
    "Moagem · entrada de cana (t)",
    "Toneladas entregues por frente, de todas as viagens da pesagem (com ou sem ordem de corte), em dias inteiros até ontem.",
    cabecalhoTabela("Frente", d.safraMoagem?.rotulo ?? "Safra"),
    corpoMoagem,
    tiposMoagem,
  );

  // operações: grupo, operações, subtotal; total geral no fim
  const corpoOps = [];
  const tiposOps = [];
  for (const g of d.operacoes.grupos) {
    corpoOps.push([{ content: g.grupo, colSpan: 11 }]);
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
  y = tabela(
    y + 4,
    "Operações · área realizada (ha)",
    "Área dos apontamentos diários lançados, por grupo (cadastro Grupos de Operações); nome da operação pelo cadastro Operações.",
    cabecalhoTabela("Operação", d.safraOperacoes?.rotulo ?? "Safra"),
    corpoOps,
    tiposOps,
  );

  p.nota(
    y + 2,
    `Dias fechados até ontem; os dias depois da data de referência ficam em branco. Semana, Mês e Safra acumulam até ${fmtDateBR(d.dt)}. ` +
      `Safra das operações ${d.safraOperacoes ? `desde ${fmtDateBR(d.safraOperacoes.inicio)}` : "desde 01/01"}; moagem ${
        d.safraMoagem ? `desde ${fmtDateBR(d.safraMoagem.inicio)}` : "desde 01/01"
      }.`,
  );

  p.salvar(`${titulo}_${d.dt.replace(/-/g, "")}.pdf`);
}
