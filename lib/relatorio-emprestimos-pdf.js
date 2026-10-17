import { fmtDateBR } from "./format";
import { abrirPdf, COR, pintarGrupo, pintarSubtotal, pintarTotal } from "./pdf-padrao";

const brl = (n) => `R$ ${(n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** quantidade e dose com até 3 casas, sem zeros à direita desnecessários */
const qt = (n) => (n === null || n === undefined ? "–" : n.toLocaleString("pt-BR", { maximumFractionDigits: 3 }));
const vu = (n) => (n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const data = (iso) => (iso ? fmtDateBR(iso.slice(0, 10)) : "–");
const plural = (n, um, varios) => `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;

const SITUACOES = ["Aberto", "Devolvido", "Pago"];
const NOME_SITUACAO = { Aberto: "Em aberto", Devolvido: "Devolvido", Pago: "Pago" };
const NOME_INDICADOR = { Aberto: "Em aberto", Devolvido: "Devolvidos", Pago: "Pagos" };
const COR_INDICADOR = { Aberto: "laranja", Devolvido: "azul", Pago: "verde" };
/** texto da situação nas tabelas (com a cor do significado, como os selos da tela) */
const COR_SITUACAO = { Aberto: COR.pendente, Devolvido: COR.azul, Pago: COR.realizado };

const situacao = (e) => (e.status === "Aberto" ? "Em aberto" : `${NOME_SITUACAO[e.status] ?? e.status}${e.dtBaixa ? ` em ${data(e.dtBaixa)}` : ""}`);
/** nº da Solicitação (ANO + MÊS + sequência no mês); sem ele, o id */
const nSolicitacao = (e) => (e.solicitacao ? String(e.solicitacao) : `#${e.id}`);

/**
 * Relatório dos Empréstimos de insumos (A4 paisagem, padrão lib/pdf-padrao), com os empréstimos da lista como estão na
 * tela (situação e busca: `filtrosTexto`). Os dois começam pelos indicadores de cada situação e o total.
 * - sintético (`tipo` "sintetico"): o resumo da tela — uma linha por empréstimo (solicitação, datas, fornecedor, fazendas,
 *   insumos, valor e situação) e o total;
 * - analítico ("analitico"): tudo de cada empréstimo — o cabeçalho dele, os insumos (código, descrição, U.M., dose,
 *   quantidade, valor unitário e total), destinatário, fazendas com a área, volume, baixa, observação, origem e quem
 *   lançou/alterou — com o total de cada um e o total geral.
 */
export async function gerarRelatorioEmprestimosPdf({ emprestimos, tipo, filtrosTexto, nomeUsuario }) {
  const analitico = tipo === "analitico";
  const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const p = await abrirPdf({
    titulo: `Empréstimos de Insumos – ${analitico ? "Analítico" : "Sintético"}`,
    subtitulo: `CRV Industrial Ltda · Unidade Capinópolis-MG · ${filtrosTexto}`,
    dataAtualizacao: hoje,
    usuario: nomeUsuario,
  });

  const total = emprestimos.reduce((a, e) => a + (e.total ?? 0), 0);
  let y = p.secao(p.topo, "Resumo", `${plural(emprestimos.length, "empréstimo", "empréstimos")} no relatório · ${filtrosTexto}`);
  y = p.indicadores(
    y,
    [
      ...SITUACOES.map((s) => {
        const l = emprestimos.filter((e) => e.status === s);
        return { rotulo: NOME_INDICADOR[s], valor: brl(l.reduce((a, e) => a + (e.total ?? 0), 0)), apoio: plural(l.length, "empréstimo", "empréstimos"), cor: COR_INDICADOR[s] };
      }),
      { rotulo: "Total", valor: brl(total), apoio: plural(emprestimos.length, "empréstimo", "empréstimos"), cor: "azul" },
    ],
    { colunas: 4 },
  );

  if (analitico) desenharAnalitico(p, y + 2, emprestimos, total);
  else desenharSintetico(p, y + 2, emprestimos, total);

  p.salvar(`Emprestimos de Insumos - ${analitico ? "Analitico" : "Sintetico"} - ${hoje}.pdf`);
}

/** Uma linha por empréstimo, como a lista da tela, e o total. */
function desenharSintetico(p, y, emprestimos, total) {
  y = p.secao(y, "Empréstimos", "Uma linha por empréstimo, como a lista da tela.");
  const corpo = emprestimos.map((e) => [
    nSolicitacao(e),
    data(e.dtSol),
    data(e.dt),
    `${e.fornNm}${e.fornCod ? ` (${e.fornCod})` : ""}`,
    e.faz.map((f) => f.cod).join(" / ") || "–",
    e.faz
      .map((f) => f.nome)
      .filter(Boolean)
      .join(" / ") || "–",
    e.itens.map((i) => i.nm).join(", ") || "–",
    brl(e.total),
    situacao(e),
  ]);
  const nTotal = corpo.length;
  corpo.push([{ content: `Total · ${plural(emprestimos.length, "empréstimo", "empréstimos")}`, colSpan: 7 }, brl(total), ""]);
  p.tabela({
    startY: y,
    head: [["Solicitação", "Data Solicitação", "Data Saída", "Fornecedor", "Fazenda", "Descrição Fazenda", "Insumos", "Valor total", "Situação"]],
    body: corpo,
    columnStyles: {
      0: { cellWidth: 19, halign: "right" },
      1: { cellWidth: 21, halign: "center" },
      2: { cellWidth: 19, halign: "center" },
      3: { cellWidth: 46 },
      4: { cellWidth: 20 },
      5: { cellWidth: 44 },
      6: {},
      7: { cellWidth: 26, halign: "right" },
      8: { cellWidth: 30 },
    },
    didParseCell: (c) => {
      if (c.section !== "body") return;
      if (c.row.index === nTotal) {
        pintarTotal(c);
        if (c.column.index === 0) c.cell.styles.halign = "right";
        return;
      }
      const e = emprestimos[c.row.index];
      if (c.column.index === 8 && e) {
        c.cell.styles.textColor = COR_SITUACAO[e.status] ?? COR.texto;
        c.cell.styles.fontStyle = "bold";
      }
    },
  });
}

/** Cada empréstimo com tudo o que tem (cabeçalho, insumos, demais dados, total dele) e o total geral. */
function desenharAnalitico(p, y, emprestimos, total) {
  y = p.secao(y, "Empréstimos em detalhe", "Cada empréstimo com os insumos, o destinatário, as fazendas e a área, o volume, a baixa e quem lançou.");
  const COLS = 7;
  // linhas com o tipo (para pintar): grupo (cabeçalho do empréstimo), item, info (demais dados), subtotal, total
  const linhas = [];
  for (const e of emprestimos) {
    const cab = [
      `Solicitação nº ${nSolicitacao(e)}`,
      `${e.fornNm}${e.fornCod ? ` (${e.fornCod})` : ""}`,
      `Solicitação ${data(e.dtSol)}`,
      `Saída ${data(e.dt)}`,
      situacao(e),
    ].join("   ·   ");
    linhas.push({ tipo: "grupo", e, cel: [{ content: cab, colSpan: COLS }] });
    for (const i of e.itens) {
      linhas.push({ tipo: "item", e, cel: [i.cod, i.nm, i.um, qt(i.dose), qt(i.qtd), vu(i.vu), brl(i.vt)] });
    }
    const info = [
      `Destinatário: ${e.fornCod} – ${e.fornNm}${e.doc ? ` · ${e.doc}` : ""}`,
      `Fazendas: ${e.faz.map((f) => `${f.cod}${f.nome ? ` – ${f.nome}` : ""}${f.area !== null && f.area !== undefined ? ` (${f.area.toLocaleString("pt-BR")} ha)` : ""}`).join("; ") || "–"}`,
      `Volume de ${e.volTipo}: ${e.vol || "–"}`,
      e.status !== "Aberto" ? `Baixa: ${situacao(e)}${e.baixaObs ? ` – ${e.baixaObs}` : ""}` : "",
      e.obs ? `Obs.: ${e.obs}` : "",
      e.ref ? `Origem: ${e.ref}` : "",
      e.boletim ? `Boletim anterior: ${e.boletim}` : "",
      `Lançado por ${e.usr || "–"} em ${data(e.criEm)}${e.atuUsr ? ` · alterado por ${e.atuUsr} em ${data(e.atuEm)}` : ""}`,
    ].filter(Boolean);
    linhas.push({ tipo: "info", e, cel: [{ content: info.join("\n"), colSpan: COLS }] });
    linhas.push({
      tipo: "subtotal",
      e,
      cel: [{ content: `Total da Solicitação nº ${nSolicitacao(e)} · ${plural(e.itens.length, "insumo", "insumos")}`, colSpan: COLS - 1 }, brl(e.total)],
    });
  }
  linhas.push({ tipo: "total", cel: [{ content: `Total geral · ${plural(emprestimos.length, "empréstimo", "empréstimos")}`, colSpan: COLS - 1 }, brl(total)] });

  p.tabela({
    startY: y,
    head: [["Código", "Descrição", "U.M.", "Dose", "Qtd", "Vl. unit.", "Vl. total"]],
    body: linhas.map((l) => l.cel),
    columnStyles: {
      0: { cellWidth: 22 },
      1: {},
      2: { cellWidth: 16, halign: "center" },
      3: { cellWidth: 20, halign: "right" },
      4: { cellWidth: 24, halign: "right" },
      5: { cellWidth: 24, halign: "right" },
      6: { cellWidth: 30, halign: "right" },
    },
    // o cabeçalho de um empréstimo não fica sozinho no pé da página
    rowPageBreak: "avoid",
    didParseCell: (c) => {
      if (c.section !== "body") return;
      const l = linhas[c.row.index];
      if (!l) return;
      if (l.tipo === "grupo") {
        pintarGrupo(c);
        c.cell.styles.halign = "left";
      } else if (l.tipo === "info") {
        c.cell.styles.fillColor = COR.branco;
        c.cell.styles.textColor = COR.apoio;
        c.cell.styles.fontSize = 6.8;
        c.cell.styles.halign = "left";
      } else if (l.tipo === "subtotal") {
        pintarSubtotal(c);
        if (c.column.index === 0) c.cell.styles.halign = "right";
      } else if (l.tipo === "total") {
        pintarTotal(c);
        if (c.column.index === 0) c.cell.styles.halign = "right";
      } else {
        // os insumos sem o zebrado: cada empréstimo já fica separado pelo cabeçalho e pelo total dele
        c.cell.styles.fillColor = COR.branco;
      }
    },
  });
}
