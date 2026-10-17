import { fmtDateBR } from "./format";
import { abrirPdf, COR, pintarTotal } from "./pdf-padrao";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const TITULO = "Comunicado de Saída de Insumo";
/** margem do texto do comunicado (documento para assinatura: mais larga que a dos relatórios) */
const MARGEM_DOC = 20;

const num = (n, casas = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
/** quantidade com até 3 casas, sem zeros à direita desnecessários (0,3 · 57 · 6,262) */
const qtd = (n) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

function dataPorExtenso(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

const INTRODUCAO =
  "A CRV INDUSTRIAL LTDA, inscrita no CNPJ sob o nº 03.937.452/0004-35, comunica a saída, a título de empréstimo, do(s) insumo(s) relacionado(s) abaixo, destinado(s) ao destinatário e ao local de aplicação identificados neste documento.";
const CONDICOES = [
  "O(s) insumo(s) destina(m)-se exclusivamente às atividades agrícolas da(s) propriedade(s) indicada(s) no Local de Aplicação, não sendo permitido o repasse a terceiros nem o uso em outra área.",
  "O destinatário responsabiliza-se pelo transporte, armazenamento, manuseio e aplicação do(s) insumo(s), de acordo com a recomendação técnica, as orientações do fabricante e as normas de segurança e ambientais vigentes, inclusive quanto à devolução das embalagens vazias, quando for o caso.",
  "A quitação do empréstimo dar-se-á pela devolução de insumo idêntico, em igual quantidade e especificação, ou pelo pagamento do valor total indicado neste documento, conforme acordado entre as partes.",
  "Este documento registra formalmente a movimentação do(s) item(ns) acima e, assinado pelas partes, comprova a entrega e o recebimento.",
];
const FECHAMENTO = "E, por estarem de acordo com as condições acima, as partes assinam este documento.";

/**
 * Tamanhos do documento, do mais folgado ao mais justo: o comunicado sai no primeiro em que cabe numa página só
 * (`fonte` do texto, `linha` entre linhas, `secao` título dos blocos, `antes` espaço antes de cada bloco, `tabela` e
 * `celula` dos insumos, `assinatura` altura de cada linha de assinaturas e `assinar` o espaço para assinar).
 */
const DENSIDADES = [
  { fonte: 10, linha: 5, secao: 10, antes: 4, tabela: 8.5, celula: 1.5, clausula: 1.5, assinatura: 23, assinar: 13, nome: 9.5, funcao: 8.5, topo: 5 },
  { fonte: 9, linha: 4.3, secao: 9.5, antes: 2.6, tabela: 7.8, celula: 1.1, clausula: 1, assinatura: 19, assinar: 10.5, nome: 9, funcao: 8, topo: 3 },
  { fonte: 8.2, linha: 3.8, secao: 9, antes: 1.6, tabela: 7.2, celula: 0.75, clausula: 0.6, assinatura: 16, assinar: 8.5, nome: 8.5, funcao: 7.5, topo: 2 },
];

/**
 * Comunicado de Saída de Insumo (o termo do empréstimo) em PDF, numa página A4 retrato, com o cabeçalho e o rodapé dos
 * relatórios (lib/pdf-padrao) e o corpo de documento: a declaração da saída, o destinatário, os insumos, o local de
 * aplicação, as condições do empréstimo, a data e as assinaturas. Assinam, na ordem do nível hierárquico, os
 * `assinaturas` ([{ nome, funcao }]: as fixadas na Solicitação — veja emitirSolicitacao) e, por último, o destinatário,
 * que assina o recebimento. Sai no tamanho mais folgado que cabe numa página (DENSIDADES); se nem o mais justo couber
 * (muitos insumos), continua na página seguinte.
 */
export async function gerarComunicadoEmprestimoPdf(e, assinaturas = []) {
  for (const [k, t] of DENSIDADES.entries()) {
    const p = await desenhar(e, assinaturas, t);
    if (p.doc.getNumberOfPages() === 1 || k === DENSIDADES.length - 1) {
      const base = dataBase(e);
      p.salvar(
        `Comunicado de Saída de Insumo_${e.solicitacao ? `${e.solicitacao}_` : ""}${e.fornNm.split(" ")[0]}_${e.faz.map((f) => f.cod).join("-")}_${fmtDateBR(base).replace(/\//g, "")}.pdf`,
      );
      return;
    }
  }
}

const dataBase = (e) => e.dtSol ?? e.dt ?? new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });

/** Desenha o comunicado com os tamanhos `t` e devolve o documento (sem salvar). */
async function desenhar(e, assinaturas, t) {
  const base = dataBase(e);
  // sem "Data atualização" no cabeçalho: a data do comunicado está no corpo ("Capinópolis, ..."); o nº da Solicitação
  // vai embaixo do título e no alto do texto
  const p = await abrirPdf({ titulo: TITULO, subtitulo: e.solicitacao ? `Solicitação nº ${e.solicitacao}` : "", orientacao: "portrait" });
  const { doc } = p;
  const util = p.larg - MARGEM_DOC * 2;
  // y = linha de base do próximo texto
  let y = p.topo + t.topo;

  const espaco = (h) => {
    if (y + h > p.base) {
      p.novaPagina();
      y = p.topo + t.topo;
    }
  };
  const paragrafo = (texto) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(t.fonte);
    doc.setTextColor(...COR.texto);
    const linhas = doc.splitTextToSize(texto, util);
    espaco(linhas.length * t.linha);
    doc.text(linhas, MARGEM_DOC, y, { align: "justify", maxWidth: util });
    y += linhas.length * t.linha;
  };
  /** Título de bloco do documento, como as seções do padrão: marca verde e texto azul. */
  const titulo = (texto) => {
    y += t.antes;
    espaco(t.linha * 2 + 2);
    doc.setFillColor(...COR.verde);
    doc.rect(MARGEM_DOC, y - t.secao * 0.33, 1.1, t.secao * 0.42, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(t.secao);
    doc.setTextColor(...COR.azul);
    doc.text(texto, MARGEM_DOC + 2.8, y);
    doc.setTextColor(...COR.texto);
    y += t.linha + 0.8;
  };
  /**
   * Linha de campos "Rótulo: valor" (rótulo em cinza, valor em destaque). O par que não cabe inteiro no resto da linha
   * passa para a linha de baixo, alinhado ao segundo par; o valor longo quebra alinhado a ele mesmo, sem passar da margem.
   */
  const campos = (pares) => {
    doc.setFontSize(t.fonte);
    espaco(t.linha);
    const separador = 6;
    const limite = MARGEM_DOC + util;
    let x = MARGEM_DOC;
    let recuo = MARGEM_DOC;
    pares.forEach(([rotulo, valor], k) => {
      const texto = String(valor);
      doc.setFont("helvetica", "normal");
      const wr = doc.getTextWidth(rotulo) + 1.4;
      doc.setFont("helvetica", "bold");
      if (x > recuo && x + wr + doc.getTextWidth(texto) > limite) {
        y += t.linha;
        espaco(t.linha);
        x = recuo;
      }
      const valorLinhas = doc.splitTextToSize(texto, limite - x - wr);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...COR.apoio);
      doc.text(rotulo, x, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...COR.texto);
      valorLinhas.forEach((l, i) => {
        if (i > 0) {
          y += t.linha;
          espaco(t.linha);
        }
        doc.text(l, x + wr, y);
      });
      x += wr + doc.getTextWidth(valorLinhas[valorLinhas.length - 1]) + separador;
      if (k === 0 && valorLinhas.length === 1 && x < MARGEM_DOC + util / 2) recuo = x;
    });
    doc.setFont("helvetica", "normal");
    y += t.linha;
  };

  // nº da Solicitação à direita, no alto do texto: "Solicitação nº" em cinza e o número em azul
  if (e.solicitacao) {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(t.secao + 1.5);
    const wNum = doc.getTextWidth(String(e.solicitacao));
    doc.setTextColor(...COR.azul);
    doc.text(String(e.solicitacao), MARGEM_DOC + util, y, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(t.fonte - 1);
    doc.setTextColor(...COR.apoio);
    doc.text("Solicitação nº ", MARGEM_DOC + util - wNum - 1, y, { align: "right" });
    doc.setTextColor(...COR.texto);
    y += t.linha + 1.5;
  }
  paragrafo(INTRODUCAO);

  // destinatário numa linha (o par que não cabe desce): nome, matrícula e documento
  titulo("Destinatário");
  const doDoc = e.doc ? `${e.doc.replace(/\D/g, "").length > 11 ? "CNPJ" : "CPF"}:` : "";
  campos([["Nome:", e.fornNm], ["Matrícula/Fornecedor:", e.fornCod], ...(e.doc ? [[doDoc, e.doc]] : [])]);

  titulo("Insumo Emprestado");
  const temDose = e.itens.some((i) => i.dose !== null);
  const cab = ["CÓDIGO", "DESCRIÇÃO", "U.M.", ...(temDose ? ["DOSE"] : []), "QTD", "VL. UNIT. (R$)", "VL. TOTAL (R$)"];
  const corpo = e.itens.map((i) => [i.cod, i.nm, i.um, ...(temDose ? [i.dose !== null ? qtd(i.dose) : ""] : []), qtd(i.qtd), num(i.vu), num(i.vt)]);
  const colTotal = cab.length - 1;
  // código e descrição à esquerda, U.M. ao centro, números à direita (o título de cada coluna segue o alinhamento dela)
  const colunas = Object.fromEntries(cab.map((_, i) => [i, { halign: i === 2 ? "center" : i > 2 ? "right" : "left" }]));
  const fim = p.tabela({
    startY: y - t.linha * 0.6,
    head: [cab],
    body: [...corpo, [{ content: "TOTAL", colSpan: colTotal, styles: { halign: "left" } }, num(e.total)]],
    styles: { fontSize: t.tabela, cellPadding: { top: t.celula, bottom: t.celula, left: 1.6, right: 1.6 } },
    headStyles: { fontSize: t.tabela },
    columnStyles: colunas,
    margin: { left: MARGEM_DOC, right: MARGEM_DOC },
    rowPageBreak: "avoid",
    didParseCell: (d) => {
      if (d.section === "body" && d.row.index === corpo.length) pintarTotal(d);
    },
  });
  y = fim + t.linha * 0.6;

  titulo("Local de Aplicação");
  for (const f of e.faz) {
    campos([["Fazenda:", f.cod], ...(f.nome ? [["Descrição Fazenda:", f.nome]] : []), ...(f.area !== null ? [["Área:", `${num(f.area)} ha`]] : [])]);
  }
  if (e.vol) campos([[`Volume de ${e.volTipo}:`, e.vol]]);

  // condições do empréstimo, numeradas (o número à esquerda, o texto alinhado depois dele)
  titulo("Condições do Empréstimo");
  CONDICOES.forEach((texto, k) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(t.fonte);
    const recuo = 5.5;
    const linhas = doc.splitTextToSize(texto, util - recuo);
    espaco(linhas.length * t.linha + t.clausula);
    doc.setTextColor(...COR.texto);
    doc.setFont("helvetica", "bold");
    doc.text(`${k + 1}.`, MARGEM_DOC, y);
    doc.setFont("helvetica", "normal");
    doc.text(linhas, MARGEM_DOC + recuo, y, { align: "justify", maxWidth: util - recuo });
    y += linhas.length * t.linha + t.clausula;
  });

  // quem assina: os da Solicitação (na ordem do nível hierárquico) e, por último, o destinatário (o recebimento)
  const daEmpresa = (assinaturas.length ? assinaturas : (e.assin ?? []).map((nome) => ({ nome, funcao: "" }))).filter((a) => String(a.nome ?? "").trim());
  const todas = [...daEmpresa, { nome: e.fornNm, funcao: ["Destinatário", e.doc ? `${doDoc} ${e.doc}` : ""].filter(Boolean).join(" · ") }];
  const porLinha = todas.length > 1 ? 2 : 1;
  const linhasAssinatura = Math.ceil(todas.length / porLinha);
  const larguraCol = (util - 12) / 2;

  // a declaração, a data e as assinaturas ficam juntas (não começam no fim de uma página e terminam na outra)
  y += t.antes;
  espaco(t.linha * 3 + 3 + linhasAssinatura * t.assinatura);
  paragrafo(FECHAMENTO);
  y += 1.5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(t.fonte);
  doc.setTextColor(...COR.texto);
  doc.text(`Capinópolis, ${dataPorExtenso(base)}.`, MARGEM_DOC, y);

  for (let i = 0; i < todas.length; i += porLinha) {
    espaco(t.assinatura);
    y += t.assinar;
    for (let j = 0; j < porLinha; j++) {
      const a = todas[i + j];
      if (!a) continue;
      const x = MARGEM_DOC + j * (larguraCol + 12);
      doc.setDrawColor(...COR.texto);
      doc.setLineWidth(0.2);
      doc.line(x, y, x + larguraCol, y);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(t.nome);
      doc.setTextColor(...COR.texto);
      doc.text(doc.splitTextToSize(String(a.nome), larguraCol)[0], x, y + t.nome * 0.45);
      if (a.funcao) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(t.funcao);
        doc.setTextColor(...COR.apoio);
        doc.text(doc.splitTextToSize(String(a.funcao), larguraCol)[0], x, y + t.nome * 0.45 + t.funcao * 0.45);
      }
    }
    y += t.assinatura - t.assinar;
  }
  doc.setTextColor(...COR.texto);
  return p;
}
