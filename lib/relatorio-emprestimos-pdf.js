import { fmtDateBR } from "./format";
import { abrirPdf, COR } from "./pdf-padrao";

const brl = (n) => `R$ ${(n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
/** quantidade e dose com até 3 casas, sem zeros à direita desnecessários */
const qt = (n) => (n === null || n === undefined ? "–" : n.toLocaleString("pt-BR", { maximumFractionDigits: 3 }));
const vu = (n) => (n ?? 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const data = (iso) => (iso ? fmtDateBR(iso.slice(0, 10)) : "–");
const plural = (n, um, varios) => `${n.toLocaleString("pt-BR")} ${n === 1 ? um : varios}`;
const ha = (n) => `${n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ha`;

const SITUACOES = ["Aberto", "Devolvido", "Pago"];
const NOME_GRUPO = { Aberto: "Em aberto", Devolvido: "Devolvidos", Pago: "Pagos" };
const COR_INDICADOR = { Aberto: "laranja", Devolvido: "azul", Pago: "verde" };
/** texto da situação com a cor do significado, como os selos da tela */
const COR_SITUACAO = { Aberto: COR.pendente, Devolvido: COR.azul, Pago: COR.realizado };

const situacao = (e) => (e.status === "Aberto" ? "Em aberto" : `${e.status === "Pago" ? "Pago" : "Devolvido"}${e.dtBaixa ? ` em ${data(e.dtBaixa)}` : ""}`);
/** nº da Solicitação (ANO + MÊS + sequência no mês); sem ele, o id */
const nSolicitacao = (e) => (e.solicitacao ? String(e.solicitacao) : `#${e.id}`);
const fazendas = (e, comArea) =>
  e.faz.map((f) => `${f.cod}${f.nome ? ` – ${f.nome}` : ""}${comArea && f.area !== null && f.area !== undefined ? ` (${ha(f.area)})` : ""}`).join("; ") || "–";
const somaDe = (l) => l.reduce((a, e) => a + (e.total ?? 0), 0);

/** Os empréstimos de cada situação, na ordem Em aberto, Devolvidos, Pagos; dentro dela, do nº mais novo ao mais antigo. */
function porSituacao(emprestimos) {
  return SITUACOES.map((s) => ({
    s,
    lista: emprestimos.filter((e) => e.status === s).sort((a, b) => (b.solicitacao ?? 0) - (a.solicitacao ?? 0) || b.id - a.id),
  })).filter((g) => g.lista.length > 0);
}

// estilos de célula (valem por cima do zebrado e do alinhamento da coluna em que a célula começa)
const GRUPO = { fillColor: COR.grupoFundo, textColor: COR.grupoTexto, fontStyle: "bold", halign: "left" };
const SUBTOTAL = { fillColor: COR.subtotal, textColor: COR.texto, fontStyle: "bold" };
const TOTAL = { fillColor: COR.azul, textColor: COR.branco, fontStyle: "bold" };
const SUBCABECALHO = { fillColor: COR.azulEscuro, textColor: COR.branco, fontStyle: "bold", halign: "left" };
const ROTULO = { fillColor: COR.branco, textColor: COR.apoio, fontSize: 6.8, halign: "left" };
const VALOR = { fillColor: COR.branco, textColor: COR.texto, fontStyle: "bold", halign: "left" };

/**
 * Relatório de Empréstimos de Insumos (A4 paisagem, padrão lib/pdf-padrao), com os empréstimos da lista como estão na
 * tela (situação e busca: `filtrosTexto`). Começa pelos totais de cada situação.
 * - sintético (`tipo` "sintetico"): uma linha por Solicitação, agrupadas por situação, com o subtotal de cada uma e o
 *   total geral;
 * - analítico ("analitico"): a ficha de cada Solicitação — destinatário, documento, datas, volume, local de aplicação,
 *   baixa e observação — com os insumos (código, descrição, U.M., dose, quantidade, valor unitário e total) e o total
 *   dela, agrupadas por situação, e o total geral.
 */
export async function gerarRelatorioEmprestimosPdf({ emprestimos, tipo, filtrosTexto, nomeUsuario }) {
  const analitico = tipo === "analitico";
  const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const p = await abrirPdf({
    titulo: `Relatório de Empréstimos de Insumos – ${analitico ? "Analítico" : "Sintético"}`,
    subtitulo: `CRV Industrial Ltda · Unidade Capinópolis-MG · ${filtrosTexto}`,
    dataAtualizacao: hoje,
    usuario: nomeUsuario,
  });

  const total = somaDe(emprestimos);
  let y = p.secao(p.topo, "Resumo por situação");
  y = p.indicadores(
    y,
    [
      ...SITUACOES.map((s) => {
        const l = emprestimos.filter((e) => e.status === s);
        return { rotulo: NOME_GRUPO[s], valor: brl(somaDe(l)), apoio: plural(l.length, "solicitação", "solicitações"), cor: COR_INDICADOR[s] };
      }),
      { rotulo: "Total", valor: brl(total), apoio: plural(emprestimos.length, "solicitação", "solicitações"), cor: "azul" },
    ],
    { colunas: 4 },
  );

  const grupos = porSituacao(emprestimos);
  if (analitico) desenharAnalitico(p, y + 2, grupos, emprestimos.length, total);
  else desenharSintetico(p, y + 2, grupos, emprestimos.length, total);

  p.salvar(`Relatorio de Emprestimos de Insumos - ${analitico ? "Analitico" : "Sintetico"} - ${hoje}.pdf`);
}

/** Uma linha por Solicitação, agrupadas por situação, com o subtotal de cada uma e o total geral. */
function desenharSintetico(p, y, grupos, n, total) {
  y = p.secao(y, "Solicitações");
  const COLS = 9;
  const corpo = [];
  for (const { s, lista } of grupos) {
    corpo.push([{ content: `${NOME_GRUPO[s]} · ${plural(lista.length, "solicitação", "solicitações")}`, colSpan: COLS, styles: GRUPO }]);
    for (const e of lista) {
      corpo.push([
        nSolicitacao(e),
        data(e.dtSol),
        data(e.dt),
        e.status === "Aberto" ? "–" : data(e.dtBaixa),
        e.fornCod || "–",
        e.fornNm,
        fazendas(e, false),
        e.itens.map((i) => i.nm).join(", ") || "–",
        brl(e.total),
      ]);
    }
    corpo.push([{ content: `Subtotal ${NOME_GRUPO[s].toLowerCase()}`, colSpan: COLS - 1, styles: { ...SUBTOTAL, halign: "right" } }, { content: brl(somaDe(lista)), styles: SUBTOTAL }]);
  }
  corpo.push([
    { content: `Total geral · ${plural(n, "solicitação", "solicitações")}`, colSpan: COLS - 1, styles: { ...TOTAL, halign: "right" } },
    { content: brl(total), styles: TOTAL },
  ]);
  p.tabela({
    startY: y,
    head: [["Solicitação", "Data Solicitação", "Data Saída", "Data Baixa", "Matrícula", "Fornecedor", "Fazendas", "Insumos", "Valor (R$)"]],
    body: corpo,
    columnStyles: {
      0: { cellWidth: 20, halign: "right" },
      1: { cellWidth: 20, halign: "center" },
      2: { cellWidth: 18, halign: "center" },
      3: { cellWidth: 18, halign: "center" },
      4: { cellWidth: 17, halign: "right" },
      5: { cellWidth: 46 },
      6: { cellWidth: 52 },
      7: {},
      8: { cellWidth: 26, halign: "right" },
    },
    rowPageBreak: "avoid",
  });
}

/** A ficha de cada Solicitação, com os insumos e o total dela, agrupadas por situação, e o total geral. */
function desenharAnalitico(p, y, grupos, n, total) {
  y = p.secao(y, "Solicitações");
  const COLS = 7;
  const rot = (t) => ({ content: t, styles: ROTULO });
  const val = (t, colSpan = 1, extra = {}) => ({ content: t, colSpan, styles: { ...VALOR, ...extra } });
  // a mesma grade em todos os blocos (as colunas dos insumos; a ficha usa as mesmas)
  const grade = {
    showHead: false,
    head: [["Código", "Descrição", "U.M.", "Dose", "Qtd", "Vl. unit.", "Vl. total"]],
    columnStyles: {
      0: { cellWidth: 28 },
      1: {},
      2: { cellWidth: 22, halign: "center" },
      3: { cellWidth: 24, halign: "right" },
      4: { cellWidth: 26, halign: "right" },
      5: { cellWidth: 28, halign: "right" },
      6: { cellWidth: 32, halign: "right" },
    },
    // os insumos sem o zebrado: cada Solicitação já fica separada pelo cabeçalho e pelo total dela
    alternateRowStyles: { fillColor: COR.branco },
    rowPageBreak: "avoid",
  };
  /**
   * Um bloco (as linhas de uma Solicitação, o título da situação, um subtotal…) numa tabela própria: o que não cabe no
   * resto da página começa na seguinte, inteiro (a Solicitação maior que uma página quebra, com o nº repetido no alto).
   */
  const bloco = (linhas, repetir = null) => {
    const altura = linhas.length * 5.2 + 2;
    y = p.espaco(y, Math.min(altura, p.base - p.topo - 10));
    let paginaAntes = p.doc.getCurrentPageInfo().pageNumber;
    y =
      p.tabela({
        ...grade,
        startY: y,
        body: linhas,
        // a Solicitação que passa de uma página: o nº dela no alto da seguinte
        didDrawPage: repetir
          ? (d) => {
              const pagina = p.doc.getCurrentPageInfo().pageNumber;
              if (pagina !== paginaAntes && d.cursor) {
                paginaAntes = pagina;
                p.doc.setFont("helvetica", "italic");
                p.doc.setFontSize(6.8);
                p.doc.setTextColor(...COR.apoio);
                p.doc.text(`${repetir} (continuação)`, p.margem, p.topo - 1.2);
                p.doc.setTextColor(...COR.texto);
              }
            }
          : undefined,
      }) + 2.5;
  };

  for (const { s, lista } of grupos) {
    bloco([[{ content: `${NOME_GRUPO[s]} · ${plural(lista.length, "solicitação", "solicitações")}`, colSpan: COLS, styles: { ...SUBCABECALHO, fillColor: COR.azul } }]]);
    for (const e of lista) {
      const linhas = [];
      // cabeçalho da Solicitação: o nº à esquerda e a situação à direita
      linhas.push([
        { content: `Solicitação nº ${nSolicitacao(e)}`, colSpan: 4, styles: GRUPO },
        { content: situacao(e), colSpan: 3, styles: { ...GRUPO, halign: "right", textColor: COR_SITUACAO[e.status] ?? COR.grupoTexto } },
      ]);
      // ficha: destinatário, documento, datas, volume, local de aplicação, baixa e observação
      linhas.push([rot("Destinatário"), val(`${e.fornCod} – ${e.fornNm}`, 3), rot(e.doc && e.doc.replace(/\D/g, "").length > 11 ? "CNPJ" : "CPF"), val(e.doc || "–", 2)]);
      linhas.push([rot("Data da solicitação"), val(data(e.dtSol)), rot("Data de saída"), val(data(e.dt)), rot(`Volume de ${e.volTipo}`), val(e.vol || "–", 2)]);
      linhas.push([rot("Local de aplicação"), val(fazendas(e, true), COLS - 1)]);
      if (e.status !== "Aberto") linhas.push([rot("Baixa"), val(`${situacao(e)}${e.baixaObs ? ` · ${e.baixaObs}` : ""}`, COLS - 1)]);
      if (e.obs) linhas.push([rot("Observação"), val(e.obs, COLS - 1, { fontStyle: "normal" })]);
      // insumos
      linhas.push(
        ["Código", "Descrição", "U.M.", "Dose", "Qtd", "Vl. unit. (R$)", "Vl. total (R$)"].map((t, i) => ({
          content: t,
          styles: { ...SUBCABECALHO, halign: i === 2 ? "center" : i >= 3 ? "right" : "left" },
        })),
      );
      for (const i of e.itens) linhas.push([i.cod, i.nm, i.um, qt(i.dose), qt(i.qtd), vu(i.vu), brl(i.vt)]);
      linhas.push([
        { content: `Total da Solicitação nº ${nSolicitacao(e)} · ${plural(e.itens.length, "insumo", "insumos")}`, colSpan: COLS - 1, styles: { ...SUBTOTAL, halign: "right" } },
        { content: brl(e.total), styles: SUBTOTAL },
      ]);
      bloco(linhas, `Solicitação nº ${nSolicitacao(e)}`);
    }
    const subtotal = [
      { content: `Subtotal ${NOME_GRUPO[s].toLowerCase()}`, colSpan: COLS - 1, styles: { ...SUBTOTAL, halign: "right" } },
      { content: brl(somaDe(lista)), styles: SUBTOTAL },
    ];
    // o último subtotal vai junto com o total geral (o total não fica sozinho numa página)
    if (s !== grupos[grupos.length - 1].s) bloco([subtotal]);
    else
      bloco([
        subtotal,
        [
          { content: `Total geral · ${plural(n, "solicitação", "solicitações")}`, colSpan: COLS - 1, styles: { ...TOTAL, halign: "right" } },
          { content: brl(total), styles: TOTAL },
        ],
      ]);
  }
}
