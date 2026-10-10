import { fmtDateBR } from "./format";

/*
 * Padrão único dos relatórios em PDF (o mesmo visual das telas do sistema e do padrão CRV):
 *
 *   cabeçalho  faixa azul CRV com filete verde; à esquerda o título e a linha de apoio, à direita a data de
 *              atualização e o logo branco da CRV — repetido em todas as páginas;
 *   seções     título azul com marca verde à esquerda e linha de apoio cinza;
 *   indicadores caixas brancas com borda fina e filete colorido à esquerda (a cor do significado), valor em destaque;
 *   tabelas    cabeçalho azul com texto branco (cada título alinhado como a coluna), linhas alternadas cinza-claro,
 *              traço fino, subtotal cinza, linha de grupo azul-claro e total geral azul; cabeçalho em dois níveis com
 *              os blocos no azul escuro (ou na cor do significado) e traço suave entre os blocos (separarBlocosCabecalho);
 *   rodapé     traço fino, "CRV Industrial · Controle Agrícola", quem gerou e quando, e "Página X de Y".
 *
 * Uso:
 *   const p = await abrirPdf({ titulo, subtitulo, dataAtualizacao, usuario, orientacao });
 *   let y = p.secao(p.topo, "Resumo", "apoio");
 *   y = p.indicadores(y, [{ rotulo, valor, unidade, apoio, cor: "verde" }]);
 *   p.tabela({ startY: y, head, body, columnStyles, didParseCell: (c) => { if (...) pintarTotal(c); } });
 *   p.salvar("Nome.pdf");
 *
 * Texto: as fontes padrão do PDF só têm os caracteres do Latin-1 (acentos, ç, –, ·, º); setas, ÷, −, › e ▲▼ não saem.
 */

/** Cores (RGB) — os mesmos tokens das telas. */
export const COR = {
  azul: [35, 57, 107], // #23396B cabeçalho, cabeçalho das tabelas, total geral
  azulEscuro: [22, 38, 74], // #16264A segunda linha de cabeçalho
  verde: [45, 138, 90], // #2D8A5A filete do cabeçalho e marca das seções
  linha: [213, 219, 225], // #D5DBE1 traços e bordas
  alternada: [244, 246, 248], // #F4F6F8 linhas pares
  subtotal: [226, 230, 235], // #E2E6EB subtotal de grupo
  grupoFundo: [233, 239, 248], // linha de grupo (ex.: "01.02.15 · HERBICIDAS")
  grupoTexto: [46, 95, 168], // #2E5FA8
  texto: [28, 36, 48], // #1C2430
  apoio: [92, 103, 119], // #5C6777
  branco: [255, 255, 255],
  apoioCabecalho: [205, 214, 232], // texto secundário sobre o azul
  separadorCabecalho: [101, 116, 151], // traço entre os blocos de um cabeçalho de tabela em dois níveis (branco suave sobre o azul)
  // significado (iguais aos indicadores das telas)
  realizado: [74, 138, 54], // verde realizado / no prazo
  pendente: [199, 106, 40], // laranja a colher / atenção
  critico: [190, 49, 50], // vermelho crítico / atraso
  neutro: [92, 103, 119], // cinza
  aviso: [154, 106, 0], // amarelo escuro (texto)
};

/** Cor do filete dos indicadores, pelo nome usado nas telas (components/pagina: Indicador). */
const COR_INDICADOR = {
  azul: { filete: [35, 57, 107], valor: [35, 57, 107] },
  verde: { filete: [93, 158, 72], valor: [74, 138, 54] },
  laranja: { filete: [215, 123, 56], valor: [199, 106, 40] },
  cinza: { filete: [92, 103, 119], valor: [92, 103, 119] },
  vermelho: { filete: [190, 49, 50], valor: [190, 49, 50] },
  amarelo: { filete: [217, 162, 27], valor: [154, 106, 0] },
};

/** Tamanhos de letra (pt). */
export const FONTE = { titulo: 13, apoio: 7.4, secao: 10, tabela: 7.4, nota: 6.6, rodape: 6.6 };

export const MARGEM = 8;
const ALTURA_CABECALHO = 16;
const FILETE = 1.3;
const ALTURA_RODAPE = 12;

/** Logo (ou outra imagem) como data URL com as dimensões, para o jsPDF. Null se não carregar. */
export async function carregarImagemInfo(url) {
  try {
    const resp = await fetch(url);
    if (!resp.ok) return null;
    const blob = await resp.blob();
    const dataUrl = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => resolve({ dataUrl, largura: img.naturalWidth, altura: img.naturalHeight });
      img.onerror = () => resolve(null);
      img.src = dataUrl;
    });
  } catch {
    return null;
  }
}

/** Linha de total geral: azul com texto branco em negrito. */
export function pintarTotal(c) {
  c.cell.styles.fillColor = COR.azul;
  c.cell.styles.textColor = COR.branco;
  c.cell.styles.fontStyle = "bold";
}

/** Linha de subtotal (total de um grupo): cinza um tom acima das linhas alternadas, em negrito. */
export function pintarSubtotal(c) {
  c.cell.styles.fillColor = COR.subtotal;
  c.cell.styles.textColor = COR.texto;
  c.cell.styles.fontStyle = "bold";
}

/** Linha de grupo (título de um bloco dentro da tabela): azul-claro com texto azul. */
export function pintarGrupo(c) {
  c.cell.styles.fillColor = COR.grupoFundo;
  c.cell.styles.textColor = COR.grupoTexto;
  c.cell.styles.fontStyle = "bold";
}

/** Segunda linha de cabeçalho (ex.: blocos "Estimado / Realizado"): azul mais escuro. */
export function pintarSubcabecalho(c) {
  c.cell.styles.fillColor = COR.azulEscuro;
  c.cell.styles.textColor = COR.branco;
  c.cell.styles.fontStyle = "bold";
}

/** Texto com cor de significado (positivo verde, negativo vermelho) — para variações e diferenças. */
export function pintarSinal(c, valor) {
  if (valor > 0) c.cell.styles.textColor = COR.realizado;
  else if (valor < 0) c.cell.styles.textColor = COR.critico;
}

/**
 * Cabeçalho em dois níveis (blocos em cima, colunas embaixo): traço suave à esquerda das colunas onde começa cada bloco,
 * nas duas linhas do cabeçalho. Chamar no `didDrawCell` da tabela com os índices das colunas que abrem um bloco.
 */
export function separarBlocosCabecalho(c, inicios) {
  if (c.section !== "head" || !inicios.includes(c.column.index)) return;
  c.doc.setDrawColor(...COR.separadorCabecalho);
  c.doc.setLineWidth(0.2);
  c.doc.line(c.cell.x, c.cell.y, c.cell.x, c.cell.y + c.cell.height);
}

/**
 * Abre um relatório no padrão: devolve o documento e as funções de desenho. O cabeçalho já vem na 1ª página e é
 * repetido em cada página nova (inclusive as que a tabela cria sozinha); o rodapé entra em todas ao salvar.
 */
export async function abrirPdf({ titulo, subtitulo = "", dataAtualizacao = "", usuario = "", orientacao = "landscape" }) {
  const { default: JsPDF } = await import("jspdf");
  const autoTable = (await import("jspdf-autotable")).default;
  const logo = await carregarImagemInfo("/logo-crv-branca-pdf.png");
  const doc = new JsPDF({ orientation: orientacao, unit: "mm", format: "a4" });
  const larg = doc.internal.pageSize.getWidth();
  const alt = doc.internal.pageSize.getHeight();
  const geradoEm = new Date();
  const comCabecalho = new Set();
  const topo = ALTURA_CABECALHO + 5;
  const base = alt - ALTURA_RODAPE - 3;

  /** Corta o texto (com "...") para caber em `largura` mm na fonte atual; o que cabe volta inteiro. */
  function cortar(texto, largura) {
    const t = String(texto);
    if (doc.getTextWidth(t) <= largura) return t;
    let r = t;
    while (r.length > 1 && doc.getTextWidth(`${r.trimEnd()}...`) > largura) r = r.slice(0, -1);
    return `${r.trimEnd()}...`;
  }

  function cabecalho() {
    const pagina = doc.getCurrentPageInfo().pageNumber;
    if (comCabecalho.has(pagina)) return;
    comCabecalho.add(pagina);
    doc.setFillColor(...COR.azul);
    doc.rect(0, 0, larg, ALTURA_CABECALHO - FILETE, "F");
    doc.setFillColor(...COR.verde);
    doc.rect(0, ALTURA_CABECALHO - FILETE, larg, FILETE, "F");
    // logo branco e data de atualização à direita (padrão CRV)
    let direita = larg - MARGEM;
    if (logo) {
      const h = 9.6;
      const w = (logo.largura / logo.altura) * h;
      doc.addImage(logo.dataUrl, "PNG", direita - w, (ALTURA_CABECALHO - FILETE - h) / 2, w, h);
      direita -= w + 5;
    }
    if (dataAtualizacao) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.6);
      doc.setTextColor(...COR.apoioCabecalho);
      doc.text("Data atualização", direita, 6.4, { align: "right" });
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(...COR.branco);
      doc.text(/^\d{4}-\d{2}-\d{2}$/.test(dataAtualizacao) ? fmtDateBR(dataAtualizacao) : dataAtualizacao, direita, 10.6, { align: "right" });
      direita -= 30;
    }
    doc.setFont("helvetica", "bold");
    doc.setFontSize(FONTE.titulo);
    doc.setTextColor(...COR.branco);
    // título e linha de apoio numa linha só, até a data e o logo; o que não cabe sai cortado com "..."
    const maxTitulo = direita - MARGEM - 4;
    doc.text(cortar(titulo, maxTitulo), MARGEM, subtitulo ? 7.6 : 9.2);
    if (subtitulo) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(FONTE.apoio);
      doc.setTextColor(...COR.apoioCabecalho);
      doc.text(cortar(subtitulo, maxTitulo), MARGEM, 11.9);
    }
    doc.setTextColor(...COR.texto);
    doc.setDrawColor(...COR.linha);
  }

  function rodapes() {
    const total = doc.getNumberOfPages();
    for (let i = 1; i <= total; i++) {
      doc.setPage(i);
      const y = alt - ALTURA_RODAPE + 3;
      doc.setDrawColor(...COR.linha);
      doc.setLineWidth(0.2);
      doc.line(MARGEM, y, larg - MARGEM, y);
      doc.setFontSize(FONTE.rodape);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...COR.azul);
      doc.text("CRV Industrial", MARGEM, y + 4);
      const w = doc.getTextWidth("CRV Industrial ");
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...COR.apoio);
      const quem = usuario ? `Gerado por ${usuario} em ${geradoEm.toLocaleString("pt-BR")}` : `Gerado em ${geradoEm.toLocaleString("pt-BR")}`;
      doc.text(`· Controle Agrícola · ${quem}`, MARGEM + w, y + 4);
      doc.text(`Página ${i} de ${total}`, larg - MARGEM, y + 4, { align: "right" });
    }
  }

  /** Página nova (com cabeçalho); devolve o y onde o conteúdo começa. */
  function novaPagina() {
    doc.addPage();
    cabecalho();
    return topo;
  }

  /** Garante `altura` mm livres a partir de y (senão abre página nova); devolve o y para desenhar. */
  function espaco(y, altura) {
    return y + altura > base ? novaPagina() : y;
  }

  /**
   * Título de seção: marca verde, texto azul e, se houver, a linha de apoio. Devolve o y para o conteúdo. No alto da
   * página a marca começa na mesma linha das tabelas e indicadores (`topo`), afastada da faixa do cabeçalho.
   */
  function secao(y, texto, apoio = "") {
    y = Math.max(espaco(y, apoio ? 16 : 12), topo + 3.3);
    doc.setFillColor(...COR.verde);
    doc.rect(MARGEM, y - 3.3, 1.1, 4.2, "F");
    doc.setFont("helvetica", "bold");
    doc.setFontSize(FONTE.secao);
    doc.setTextColor(...COR.azul);
    doc.text(texto, MARGEM + 2.8, y);
    if (apoio) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(FONTE.nota);
      doc.setTextColor(...COR.apoio);
      doc.text(doc.splitTextToSize(apoio, larg - 2 * MARGEM - 3)[0], MARGEM + 2.8, y + 3.8);
    }
    doc.setTextColor(...COR.texto);
    return y + (apoio ? 7.2 : 3.6);
  }

  /**
   * Indicadores lado a lado (como os das telas): rótulo, valor em destaque (com unidade) e apoio. `cor`: azul, verde,
   * laranja, cinza, vermelho ou amarelo. Devolve o y depois deles.
   */
  function indicadores(y, itens, { colunas = itens.length, altura = 15.5, x0 = MARGEM, largura = larg - 2 * MARGEM } = {}) {
    const gap = 3;
    const linhas = Math.ceil(itens.length / colunas);
    y = espaco(y, linhas * (altura + gap));
    const w = (largura - gap * (colunas - 1)) / colunas;
    itens.forEach((it, i) => {
      const x = x0 + (i % colunas) * (w + gap);
      const yy = y + Math.floor(i / colunas) * (altura + gap);
      const cor = COR_INDICADOR[it.cor] ?? null;
      doc.setFillColor(...COR.branco);
      doc.setDrawColor(...COR.linha);
      doc.setLineWidth(0.2);
      doc.roundedRect(x, yy, w, altura, 1.2, 1.2, "FD");
      if (cor) {
        doc.setFillColor(...cor.filete);
        doc.rect(x, yy, 1.1, altura, "F");
      }
      doc.setFont("helvetica", "normal");
      doc.setFontSize(6.8);
      doc.setTextColor(...COR.apoio);
      doc.text(doc.splitTextToSize(String(it.rotulo), w - 5)[0], x + 3.2, yy + 4.4);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(12.5);
      doc.setTextColor(...(cor?.valor ?? COR.texto));
      const valor = String(it.valor);
      doc.text(valor, x + 3.2, yy + 10.2);
      if (it.unidade) {
        const wv = doc.getTextWidth(valor);
        doc.setFont("helvetica", "normal");
        doc.setFontSize(7);
        doc.setTextColor(...COR.apoio);
        doc.text(String(it.unidade), x + 3.2 + wv + 1, yy + 10.2);
      }
      if (it.apoio) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(6.2);
        doc.setTextColor(...COR.apoio);
        doc.text(doc.splitTextToSize(String(it.apoio), w - 5)[0], x + 3.2, yy + 13.6);
      }
    });
    doc.setTextColor(...COR.texto);
    return y + linhas * (altura + gap) + 1;
  }

  /** Nota de rodapé de um bloco (texto cinza pequeno); devolve o y depois dela. */
  function nota(y, texto) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(FONTE.nota);
    const linhas = (Array.isArray(texto) ? texto : [texto]).flatMap((t) => doc.splitTextToSize(t, larg - 2 * MARGEM));
    y = espaco(y, linhas.length * 2.9 + 1);
    doc.setTextColor(...COR.apoio);
    doc.text(linhas, MARGEM, y + 2.4);
    doc.setTextColor(...COR.texto);
    return y + linhas.length * 2.9 + 2;
  }

  /**
   * Tabela no padrão (jspdf-autotable). As opções passadas valem por cima do padrão; `didDrawPage` e `didParseCell`
   * do relatório são chamados depois dos do padrão. Como nas telas, o título de cada coluna segue o alinhamento dela
   * (texto à esquerda, números à direita, pelo `columnStyles`) quando o relatório não fixa o alinhamento do cabeçalho;
   * os títulos de bloco (que juntam colunas) ficam centralizados.
   */
  function tabela(opcoes) {
    const { styles, headStyles, bodyStyles, footStyles, alternateRowStyles, margin, didDrawPage, didParseCell, ...resto } = opcoes;
    const alinharCabecalho = headStyles?.halign === undefined;
    autoTable(doc, {
      theme: "grid",
      startY: topo,
      styles: {
        font: "helvetica",
        fontSize: FONTE.tabela,
        cellPadding: { top: 1.1, bottom: 1.1, left: 1.6, right: 1.6 },
        textColor: COR.texto,
        lineColor: COR.linha,
        lineWidth: 0.1,
        valign: "middle",
        overflow: "linebreak",
        ...styles,
      },
      headStyles: { fillColor: COR.azul, textColor: COR.branco, fontStyle: "bold", halign: "center", valign: "middle", lineColor: COR.azul, ...headStyles },
      bodyStyles: { fillColor: COR.branco, ...bodyStyles },
      footStyles: { fillColor: COR.azul, textColor: COR.branco, fontStyle: "bold", ...footStyles },
      alternateRowStyles: { fillColor: COR.alternada, ...alternateRowStyles },
      margin: { top: topo, left: MARGEM, right: MARGEM, bottom: ALTURA_RODAPE + 5, ...margin },
      didDrawPage: (d) => {
        cabecalho();
        if (didDrawPage) didDrawPage(d);
      },
      didParseCell: (c) => {
        if (alinharCabecalho && c.section === "head" && c.cell.colSpan === 1 && c.cell.raw?.styles?.halign === undefined) {
          c.cell.styles.halign = resto.columnStyles?.[c.column.index]?.halign ?? styles?.halign ?? "left";
        }
        if (didParseCell) didParseCell(c);
      },
      ...resto,
    });
    return doc.lastAutoTable?.finalY ?? topo;
  }

  function salvar(nomeArquivo) {
    rodapes();
    doc.save(nomeArquivo);
  }

  cabecalho();
  return { doc, autoTable, larg, alt, margem: MARGEM, topo, base, cabecalho, novaPagina, espaco, secao, indicadores, nota, tabela, salvar };
}
