import { fmtDateBR } from "./format";
import { abrirPdf, COR, FONTE, pintarTotal } from "./pdf-padrao";

const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const TITULO = "Comunicado de Saída de Insumo";
/** margem do texto do comunicado (documento para assinatura: mais larga que a dos relatórios) */
const MARGEM_DOC = 20;
/** distância entre as linhas do texto */
const LINHA = 5;

const num = (n, casas = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas });
/** quantidade com até 3 casas, sem zeros à direita desnecessários (0,3 · 57 · 6,262) */
const qtd = (n) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });

function dataPorExtenso(iso) {
  const [a, m, d] = iso.split("-").map(Number);
  return `${d} de ${MESES[m - 1]} de ${a}`;
}

/**
 * Comunicado de Saída de Insumo (o termo do empréstimo) em PDF (A4 retrato), com o cabeçalho e o rodapé dos relatórios
 * (lib/pdf-padrao) e o corpo de documento: a declaração da saída, o destinatário, os insumos, o local de aplicação, as
 * condições do empréstimo, a data e as assinaturas. Assinam, na ordem do nível hierárquico, os ativos do cadastro
 * Assinaturas (Insumos › Empréstimos › Assinaturas: `assinaturas`, [{ nome, funcao }]) — sem nenhum, os nomes gravados
 * no empréstimo — e, por último, o destinatário, que assina o recebimento.
 */
export async function gerarComunicadoEmprestimoPdf(e, assinaturas = []) {
  const base = e.dtSol ?? e.dt ?? new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  // sem "Data atualização" no cabeçalho: o comunicado não tinha esse campo, e a data dele já está no corpo ("Capinópolis, ...");
  // o nº da Solicitação vai embaixo do título (em todas as páginas) e no alto do texto
  const p = await abrirPdf({ titulo: TITULO, subtitulo: e.solicitacao ? `Solicitação nº ${e.solicitacao}` : "", orientacao: "portrait" });
  const { doc } = p;
  const util = p.larg - MARGEM_DOC * 2;
  // y = linha de base do próximo texto
  let y = p.topo + 5;

  const espaco = (h) => {
    if (y + h > p.base) {
      p.novaPagina();
      y = p.topo + 5;
    }
  };
  const paragrafo = (texto, opts = {}) => {
    doc.setFont("helvetica", opts.negrito ? "bold" : "normal");
    doc.setFontSize(opts.tamanho ?? 10);
    doc.setTextColor(...COR.texto);
    const linhas = doc.splitTextToSize(texto, util - (opts.recuo ?? 0));
    espaco(linhas.length * LINHA);
    doc.text(linhas, MARGEM_DOC + (opts.recuo ?? 0), y, opts.justificar ? { align: "justify", maxWidth: util - (opts.recuo ?? 0) } : undefined);
    y += linhas.length * LINHA;
  };
  /** Título de bloco do documento, como as seções do padrão: marca verde e texto azul. */
  const titulo = (texto) => {
    espaco(LINHA + 6);
    doc.setFillColor(...COR.verde);
    doc.rect(MARGEM_DOC, y - 3.3, 1.1, 4.2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(FONTE.secao);
    doc.setTextColor(...COR.azul);
    doc.text(texto, MARGEM_DOC + 2.8, y);
    doc.setTextColor(...COR.texto);
    y += LINHA + 1;
  };
  /**
   * Linha de campos "Rótulo: valor" (rótulo em cinza, valor em destaque), separados como no modelo. O par que não
   * cabe inteiro no resto da linha passa para a linha de baixo, alinhado ao segundo par (fica claro que é a mesma
   * fazenda); o valor longo quebra alinhado a ele mesmo, sem passar da margem.
   */
  const campos = (pares) => {
    doc.setFontSize(10);
    espaco(LINHA);
    const separador = 6;
    const limite = MARGEM_DOC + util;
    let x = MARGEM_DOC;
    // onde começam os pares que descem para a linha de baixo
    let recuo = MARGEM_DOC;
    pares.forEach(([rotulo, valor], k) => {
      const texto = String(valor);
      doc.setFont("helvetica", "normal");
      const wr = doc.getTextWidth(rotulo) + 1.6;
      doc.setFont("helvetica", "bold");
      if (x > recuo && x + wr + doc.getTextWidth(texto) > limite) {
        y += LINHA;
        espaco(LINHA);
        x = recuo;
      }
      const valorLinhas = doc.splitTextToSize(texto, limite - x - wr);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...COR.apoio);
      doc.text(rotulo, x, y);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...COR.texto);
      valorLinhas.forEach((t, i) => {
        if (i > 0) {
          y += LINHA;
          espaco(LINHA);
        }
        doc.text(t, x + wr, y);
      });
      x += wr + doc.getTextWidth(valorLinhas[valorLinhas.length - 1]) + separador;
      if (k === 0 && valorLinhas.length === 1 && x < MARGEM_DOC + util / 2) recuo = x;
    });
    doc.setFont("helvetica", "normal");
    y += LINHA;
  };

  // nº da Solicitação à direita, no alto do texto: "Solicitação nº" em cinza e o número em azul
  if (e.solicitacao) {
    const rotulo = "Solicitação nº ";
    doc.setFont("helvetica", "bold");
    doc.setFontSize(12);
    const wNum = doc.getTextWidth(String(e.solicitacao));
    doc.setTextColor(...COR.azul);
    doc.text(String(e.solicitacao), MARGEM_DOC + util, y, { align: "right" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...COR.apoio);
    doc.text(rotulo, MARGEM_DOC + util - wNum - 1, y, { align: "right" });
    doc.setTextColor(...COR.texto);
    y += LINHA + 3;
  }
  paragrafo(
    "A CRV INDUSTRIAL LTDA, inscrita no CNPJ sob o nº 03.937.452/0004-35, comunica a saída, a título de empréstimo, do(s) insumo(s) relacionado(s) abaixo, destinado(s) ao destinatário e ao local de aplicação identificados neste documento.",
    { justificar: true },
  );
  y += 4;

  titulo("Destinatário:");
  campos([["Nome:", `${e.fornCod} – ${e.fornNm}`]]);
  campos([["Matrícula/Fornecedor:", e.fornCod]]);
  if (e.doc) campos([[`${e.doc.replace(/\D/g, "").length > 11 ? "CNPJ" : "CPF"}:`, e.doc]]);
  y += 3;

  titulo("Insumo Emprestado:");
  const temDose = e.itens.some((i) => i.dose !== null);
  const cab = ["CÓDIGO", "DESCRIÇÃO", "U.M.", ...(temDose ? ["Dose"] : []), "QTD", "VL. UNIT.", "VL. TOTAL"];
  const corpo = e.itens.map((i) => [i.cod, i.nm, i.um, ...(temDose ? [i.dose !== null ? qtd(i.dose) : ""] : []), qtd(i.qtd), num(i.vu), num(i.vt)]);
  const colTotal = cab.length - 1;
  // código e descrição à esquerda, U.M. ao centro, números à direita (o título de cada coluna segue o alinhamento dela)
  const colunas = Object.fromEntries(cab.map((_, i) => [i, { halign: i === 2 ? "center" : i > 2 ? "right" : "left" }]));
  const fim = p.tabela({
    startY: y - 3,
    head: [cab],
    body: [...corpo, [{ content: "TOTAL", colSpan: colTotal, styles: { halign: "left" } }, num(e.total)]],
    styles: { fontSize: 8.5, cellPadding: 1.6 },
    headStyles: { fontSize: 8.5 },
    columnStyles: colunas,
    margin: { left: MARGEM_DOC, right: MARGEM_DOC },
    rowPageBreak: "avoid",
    didParseCell: (d) => {
      if (d.section === "body" && d.row.index === corpo.length) pintarTotal(d);
    },
  });
  y = fim + 8;

  espaco(30);
  titulo("Local de Aplicação:");
  for (const f of e.faz) {
    campos([["Fazenda:", f.cod], ...(f.nome ? [["Descrição Fazenda:", f.nome]] : []), ...(f.area !== null ? [["Área:", `${num(f.area)} ha`]] : [])]);
  }
  if (e.vol) campos([[`Volume de ${e.volTipo}:`, e.vol]]);
  y += 4;

  // condições do empréstimo, numeradas (o número à esquerda, o texto alinhado depois dele)
  titulo("Condições do Empréstimo:");
  const clausula = (n, texto) => {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    const recuo = 6;
    const linhas = doc.splitTextToSize(texto, util - recuo);
    espaco(linhas.length * LINHA + 1.5);
    doc.setTextColor(...COR.texto);
    doc.setFont("helvetica", "bold");
    doc.text(`${n}.`, MARGEM_DOC, y);
    doc.setFont("helvetica", "normal");
    doc.text(linhas, MARGEM_DOC + recuo, y, { align: "justify", maxWidth: util - recuo });
    y += linhas.length * LINHA + 1.5;
  };
  [
    "O(s) insumo(s) destina(m)-se exclusivamente às atividades agrícolas da(s) propriedade(s) indicada(s) no Local de Aplicação, não sendo permitido o repasse a terceiros nem o uso em outra área.",
    "O destinatário responsabiliza-se pelo transporte, armazenamento, manuseio e aplicação do(s) insumo(s), de acordo com a recomendação técnica, as orientações do fabricante e as normas de segurança e ambientais vigentes, inclusive quanto à devolução das embalagens vazias, quando for o caso.",
    "A quitação do empréstimo dar-se-á pela devolução de insumo idêntico, em igual quantidade e especificação, ou pelo pagamento do valor total indicado neste documento, conforme acordado entre as partes.",
    "Este documento registra formalmente a movimentação do(s) item(ns) acima e, assinado pelas partes, comprova a entrega e o recebimento.",
  ].forEach((t, k) => clausula(k + 1, t));
  y += 3;

  // quem assina: o cadastro Assinaturas (na ordem do nível hierárquico) e, por último, o destinatário (o recebimento)
  const daEmpresa = (assinaturas.length ? assinaturas : e.assin.map((nome) => ({ nome, funcao: "" }))).filter((a) => String(a.nome ?? "").trim());
  const doDoc = e.doc ? `${e.doc.replace(/\D/g, "").length > 11 ? "CNPJ" : "CPF"}: ${e.doc}` : "";
  const todas = [...daEmpresa, { nome: e.fornNm, funcao: ["Destinatário", doDoc].filter(Boolean).join(" · ") }];
  const porLinha = todas.length > 1 ? 2 : 1;
  const larguraCol = (util - 12) / 2;
  // espaço para assinar acima da linha, a linha, o nome e a função
  const alturaLinha = 24;

  // a declaração e a data não ficam no fim de uma página com as assinaturas na seguinte
  espaco(LINHA * 3 + 4 + alturaLinha);
  paragrafo("E, por estarem de acordo com as condições acima, as partes assinam este documento.", { justificar: true });
  y += 3;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(...COR.texto);
  doc.text(`Capinópolis, ${dataPorExtenso(base)}.`, MARGEM_DOC, y);
  y += 2;

  for (let i = 0; i < todas.length; i += porLinha) {
    espaco(alturaLinha);
    y += 14;
    for (let j = 0; j < porLinha; j++) {
      const a = todas[i + j];
      if (!a) continue;
      const x = MARGEM_DOC + j * (larguraCol + 12);
      doc.setDrawColor(...COR.texto);
      doc.setLineWidth(0.2);
      doc.line(x, y, x + larguraCol, y);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9.5);
      doc.setTextColor(...COR.texto);
      doc.text(doc.splitTextToSize(String(a.nome), larguraCol)[0], x, y + 4.5);
      if (a.funcao) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(8.5);
        doc.setTextColor(...COR.apoio);
        doc.text(doc.splitTextToSize(String(a.funcao), larguraCol)[0], x, y + 8.6);
      }
    }
    y += 10;
  }
  doc.setTextColor(...COR.texto);

  p.salvar(`Comunicado de Saída de Insumo_${e.solicitacao ? `${e.solicitacao}_` : ""}${e.fornNm.split(" ")[0]}_${e.faz.map((f) => f.cod).join("-")}_${fmtDateBR(base).replace(/\//g, "")}.pdf`);
}
