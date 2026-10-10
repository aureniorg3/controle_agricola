import {
  addDays,
  calcAreaColhidaHa,
  calcOrdemMetrics,
  calcProducaoAreaColhida,
  calcTalhaoDiaAnterior,
  calcTalhaoDiaAtualAte6h,
  calcTalhaoEntradaPeriodo,
  mesAnteriorRange,
  quinzenaRange,
  startOfMonth,
  startOfWeekMonday,
  deltaProjetadoPct,
  fmtDeltaPct,
} from "./period";
import { fmtDateBR, fmtHa, fmtT, fmtTch, rotuloMesAbrev } from "./format";
import { agruparClimaPorEstacao, itensClima, rotuloClima } from "./clima";
import { abrirPdf, COR, MARGEM, pintarSubtotal, pintarTotal, separarBlocosCabecalho } from "./pdf-padrao";

// o carregador do logo agora mora no padrão dos relatórios; continua exportado daqui para quem já importava
export { carregarImagemInfo } from "./pdf-padrao";

/** Cantos dos cards e quadros (mm), como nos indicadores do padrão. */
const RAIO = 1.2;

/**
 * Fundos claros das cores de significado — os mesmos das telas (good-50, amber-50, alert-50; o azul é o da linha de
 * grupo do padrão). O padrão (lib/pdf-padrao) só tem as cores cheias.
 */
const FUNDO = {
  verde: [232, 245, 233],
  amarelo: [255, 244, 214],
  vermelho: [255, 235, 238],
  azul: COR.grupoFundo,
  /** linhas de TCH do card (como na tela) */
  creme: [255, 255, 232],
  /** quadro "Produção no período" (como na tela) */
  producao: [255, 255, 209],
};
/** Filete das ordens encerradas: o mesmo âmbar do indicador "amarelo" do padrão (Ordens encerradas). */
const AMARELO = [217, 162, 27];

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Clima da Zeus por fazenda (mesmo formato da rota /api/clima/chuva). */
const fmtClima = (n, casas = 0) => (n == null ? "—" : n.toLocaleString("pt-BR", { minimumFractionDigits: casas, maximumFractionDigits: casas }));

/** Ícones de clima em traço fino (~3 mm), desenhados com primitivas do jsPDF. */
function desenharIcone(doc, tipo, cx, cy, cor) {
  doc.setDrawColor(...cor);
  doc.setLineWidth(0.22);
  if (tipo === "chuva") {
    doc.circle(cx - 0.6, cy - 0.7, 0.85, "S");
    doc.circle(cx + 0.7, cy - 0.5, 0.7, "S");
    doc.line(cx - 1.4, cy + 0.1, cx + 1.4, cy + 0.1);
    doc.line(cx - 0.9, cy + 0.6, cx - 1.2, cy + 1.4);
    doc.line(cx, cy + 0.6, cx - 0.3, cy + 1.4);
    doc.line(cx + 0.9, cy + 0.6, cx + 0.6, cy + 1.4);
  } else if (tipo === "termometro") {
    doc.roundedRect(cx - 0.35, cy - 1.5, 0.7, 2.2, 0.35, 0.35, "S");
    doc.circle(cx, cy + 1.05, 0.7, "S");
    doc.line(cx, cy - 0.4, cx, cy + 0.8);
  } else if (tipo === "gota") {
    doc.triangle(cx, cy - 1.6, cx - 0.95, cy + 0.1, cx + 0.95, cy + 0.1, "S");
    doc.circle(cx, cy + 0.55, 0.95, "S");
  } else if (tipo === "vento") {
    doc.line(cx - 1.5, cy - 0.8, cx + 0.9, cy - 0.8);
    doc.line(cx - 1.5, cy, cx + 1.5, cy);
    doc.line(cx - 1.5, cy + 0.8, cx + 0.4, cy + 0.8);
  } else {
    doc.circle(cx, cy, 0.75, "S");
    for (let i = 0; i < 8; i++) {
      const a = (i * Math.PI) / 4;
      doc.line(cx + Math.cos(a) * 1.15, cy + Math.sin(a) * 1.15, cx + Math.cos(a) * 1.65, cy + Math.sin(a) * 1.65);
    }
  }
}

/**
 * Tamanhos de fonte (pt) dos cards no PDF, pensados para a leitura impressa:
 * nada abaixo de 6 pt, números da tabela em 7 pt e valores dos quadros em 9–10,5 pt.
 */
const FONTE_CARD = {
  titulo: 10,
  fazenda: 7,
  rotulo: 6.5,
  tabela: 7,
  valor: 9,
  producao: 10.5,
  selo: 6.5,
  climaValor: 7,
  climaRotulo: 6,
};

/**
 * Monta (mede, mas não desenha) um card de ordem no formato da tela, empilhado
 * para caber 4 por linha: cabeçalho, talhões, bloco de TCH, áreas, progresso,
 * produção e TCH médio com selo, tipo de cana e o clima no rodapé. Devolve a
 * altura exata que vai ocupar e `desenhar(x, y)` — as duas usam o mesmo
 * roteiro (`percorrer`), então a altura medida é sempre a desenhada.
 */
function montarCardOrdem(
  doc,
  ordem,
  period,
  referencia,
  largura,
  tch,

  clima,
) {
  const F = FONTE_CARD;
  const pad = 2.4;
  const faixa = 1.3;
  const W = largura - faixa - pad * 2;
  /** altura de linha da tabela de talhões e do bloco de TCH (fonte 7) */
  const LT = 3.5;
  const baseLinha = LT - 1;
  const aberta = ordem.status === "Aberta";

  doc.setFont("helvetica", "normal");
  doc.setFontSize(F.fazenda);
  const fazendas = [...new Set(ordem.talhoes.map((t) => `${t.fazendaCodigo} · ${t.fazendaNome}`))].join(" / ");
  const linhasFazenda = doc.splitTextToSize(fazendas || "Sem talhão cadastrado", W);

  const m = calcOrdemMetrics(ordem, period, referencia);
  const areaColhidaHa = calcAreaColhidaHa(ordem);
  // quadro: produção que entrou pela área colhida apontada ÷ essa área; linha do bloco de TCH: entrada total ÷ área da ordem
  const tchMedio = calcProducaoAreaColhida(ordem, referencia).tch;
  const progresso = m.areaTotalHa > 0 ? Math.min(100, Math.round((areaColhidaHa / m.areaTotalHa) * 100)) : 0;
  const diaAnteriorIso = addDays(referencia, -1);
  const totalDiaAnteriorT = round2(ordem.entradas.filter((e) => e.data === diaAnteriorIso).reduce((s, e) => s + e.toneladas, 0));
  const totalDiaAtual6hT = round2(ordem.entradas.filter((e) => e.data === referencia).reduce((s, e) => s + e.toneladasAte6h, 0));

  // bloco de TCH (abaixo dos talhões); campos sem dado ficam em branco
  const realDe = (safra) => tch.historico?.find((h) => h.safra === safra)?.tchReal ?? null;
  const estimado = tch.historico?.find((h) => h.safra === tch.safraAtual)?.tchEst ?? null;
  const mostrarTch = tch.safrasAnteriores.length > 0 || !!tch.historico;
  const linhasTch = mostrarTch
    ? [
        { texto: "Área Liberada (Ordem)", valor: fmtHa(m.areaTotalHa), fundo: FUNDO.verde },
        ...[...tch.safrasAnteriores].reverse().map((safra) => ({
          texto: `TCH Realizado Safra ${safra}`,
          valor: realDe(safra) !== null ? fmtTch(realDe(safra)) : "",
          fundo: FUNDO.creme,
        })),
        { texto: `TCH Estimado ${tch.safraAtual}`, valor: estimado !== null ? fmtTch(estimado) : "", fundo: FUNDO.creme },
        ...(tch.divergenciaPct !== undefined
          ? [
              {
                texto: "(!) TCH real vs. estimado",
                valor: `${tch.divergenciaPct >= 0 ? "+" : "-"}${Math.abs(tch.divergenciaPct).toFixed(0)}%`,
                fundo: FUNDO.amarelo,
                cor: COR.aviso,
              },
            ]
          : []),
        { texto: "TCH Médio Realizado", valor: fmtTch(m.tchGeralRealizado), fundo: FUNDO.amarelo },
      ]
    : [];

  // ordem com mais de uma fazenda: talhões agrupados por fazenda, cada grupo com a sua faixa
  // (o número do talhão se repete entre fazendas e sem a faixa não dá para saber de qual é)
  const gruposFazenda = [];
  for (const t of ordem.talhoes) {
    let g = gruposFazenda.find((x) => x.fazendaCodigo === t.fazendaCodigo);
    if (!g) {
      g = { fazendaCodigo: t.fazendaCodigo, fazendaNome: t.fazendaNome, talhoes: [] };
      gruposFazenda.push(g);
    }
    g.talhoes.push(t);
  }
  const variasFazendas = gruposFazenda.length > 1;
  const linhasTalhoes = gruposFazenda.flatMap((g) => [
    ...(variasFazendas ? [{ faixa: `${g.fazendaCodigo} · ${g.fazendaNome}` }] : []),
    ...g.talhoes.map((t) => ({ talhao: t })),
  ]);

  // rodapé de clima (Zeus): um bloco por estação (fazendas da mesma estação juntas), itens em 3 colunas
  const climaFazendas = clima
    ? agruparClimaPorEstacao(
        gruposFazenda.map((g) => ({ codigo: g.fazendaCodigo, nome: g.fazendaNome })),
        clima,
      )
    : [];
  const temClima = climaFazendas.some((x) => x.c);
  const alturaLinhaClima = 7.4;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(F.climaRotulo);
  const rotulosClima = climaFazendas.map((g) => (variasFazendas ? doc.splitTextToSize(g.fazendas.map((f) => `${f.codigo} · ${f.nome}`).join(" / "), W) : []));
  const ultimaLeitura = climaFazendas
    .map((f) => f.c?.ultimaLeitura)
    .filter((v) => !!v)
    .sort()
    .pop();

  const cw = W / 3;
  const colsTalhao = (() => {
    const wTalhao = W * 0.16;
    const wResto = (W - wTalhao) / 4;
    return [
      { x: wTalhao / 2, align: "center" },
      { x: wTalhao + wResto, align: "right" },
      { x: wTalhao + wResto * 2, align: "right" },
      { x: wTalhao + wResto * 3, align: "right" },
      { x: wTalhao + wResto * 4 - 0.6, align: "right" },
    ];
  })();

  function caixa(bx, by, bw, bh, fundo) {
    doc.setFillColor(...fundo);
    doc.roundedRect(bx, by, bw, bh, RAIO, RAIO, "F");
  }

  /** Selo arredondado com o texto na linha de base `sy`; devolve a largura. */
  function selo(texto, sx, sy, fundo, corTexto, alinharDireita = false, larguraMax, pintar = true) {
    doc.setFont("helvetica", "bold");
    let fonte = F.selo;
    doc.setFontSize(fonte);
    // texto longo (ex.: tipo de cana) encolhe até caber, mas não abaixo de 6 pt
    while (larguraMax && doc.getTextWidth(texto) + 3.6 > larguraMax && fonte > 6) {
      fonte -= 0.1;
      doc.setFontSize(fonte);
    }
    const w = doc.getTextWidth(texto) + 3.6;
    if (pintar) {
      const px = alinharDireita ? sx - w : sx;
      doc.setFillColor(...fundo);
      doc.roundedRect(px, sy - 2.9, w, 4.1, 2, 2, "F");
      doc.setTextColor(...corTexto);
      doc.text(texto, px + 1.8, sy);
      doc.setTextColor(...COR.texto);
    }
    return w;
  }

  /** Percorre o card de cima para baixo; com `pintar` desenha, sem ele só mede. Devolve o y final. */
  function percorrer(x, y, pintar, altura = 0) {
    const xi = x + faixa + pad;
    let cy = y + pad;

    // ------------------------------ cabeçalho
    cy += 3.8;
    if (pintar) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(F.titulo);
      doc.setTextColor(...COR.azul);
      doc.text(`Ordem ${ordem.numero}`, xi, cy);
      selo(ordem.status, xi + W, cy - 0.2, aberta ? FUNDO.verde : FUNDO.amarelo, aberta ? COR.realizado : COR.aviso, true);
    }
    cy += 3.4;
    if (pintar) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(F.fazenda);
      doc.setTextColor(...COR.apoio);
      linhasFazenda.forEach((l, i) => doc.text(l, xi, cy + i * 3));
    }
    cy += (linhasFazenda.length - 1) * 3 + 1.6;

    // ------------------------------ talhões (cabeçalho azul, linhas alternadas, faixa de fazenda e total como nas tabelas)
    cy += 2.8;
    if (pintar) {
      doc.setFont("helvetica", "bold");
      doc.setFontSize(F.rotulo);
      doc.setTextColor(...COR.apoio);
      doc.text("TALHÕES", xi, cy);
    }
    cy += 1.2;
    const linhaTabela = (valores) => colsTalhao.forEach((c, i) => doc.text(valores[i], xi + c.x, cy + baseLinha, { align: c.align }));
    if (linhasTalhoes.length > 0) {
      const topoTalhoes = cy;
      if (pintar) {
        doc.setFillColor(...COR.azul);
        doc.rect(xi, cy, W, LT, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(F.rotulo);
        doc.setTextColor(...COR.branco);
        linhaTabela(["Talhão", "Área", "D.Ant.", "D.Atual", "Acum."]);
      }
      cy += LT;
      let seq = 0;
      for (const l of linhasTalhoes) {
        if (pintar) {
          if ("faixa" in l) {
            doc.setFillColor(...COR.grupoFundo);
            doc.rect(xi, cy, W, LT, "F");
            doc.setFont("helvetica", "bold");
            doc.setFontSize(F.rotulo);
            doc.setTextColor(...COR.grupoTexto);
            doc.text(doc.splitTextToSize(l.faixa, W - 2)[0], xi + 1, cy + baseLinha);
          } else {
            if (seq % 2 === 1) {
              doc.setFillColor(...COR.alternada);
              doc.rect(xi, cy, W, LT, "F");
            }
            const t = l.talhao;
            doc.setFont("helvetica", "normal");
            doc.setFontSize(F.tabela);
            doc.setTextColor(...COR.texto);
            linhaTabela([
              t.talhao,
              fmtHa(t.areaHa),
              fmtT(calcTalhaoDiaAnterior(ordem, t, referencia)),
              fmtT(calcTalhaoDiaAtualAte6h(ordem, t, referencia)),
              fmtT(calcTalhaoEntradaPeriodo(ordem, t, "safra", referencia)),
            ]);
          }
        }
        seq = "faixa" in l ? 0 : seq + 1;
        cy += LT;
      }
      if (pintar) {
        doc.setFillColor(...COR.azul);
        doc.rect(xi, cy, W, LT, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(F.tabela);
        doc.setTextColor(...COR.branco);
        linhaTabela(["Total", fmtHa(m.areaTotalHa), fmtT(totalDiaAnteriorT), fmtT(totalDiaAtual6hT), fmtT(m.acumSafraT)]);
        doc.setTextColor(...COR.texto);
        doc.setDrawColor(...COR.linha);
        doc.setLineWidth(0.1);
        doc.rect(xi, topoTalhoes, W, cy + LT - topoTalhoes);
      }
      cy += LT;
    } else {
      if (pintar) {
        doc.setFont("helvetica", "normal");
        doc.setFontSize(F.tabela);
        doc.setTextColor(...COR.apoio);
        doc.text("Sem talhão cadastrado.", xi, cy + baseLinha);
        doc.setTextColor(...COR.texto);
      }
      cy += LT;
    }

    // ------------------------------ bloco de TCH
    if (linhasTch.length > 0) {
      cy += 1.6;
      const topoTch = cy;
      for (const l of linhasTch) {
        if (pintar) {
          doc.setFillColor(...l.fundo);
          doc.rect(xi, cy, W, LT, "F");
          doc.setFont("helvetica", "normal");
          doc.setFontSize(F.tabela);
          doc.setTextColor(...(l.cor ?? COR.texto));
          doc.text(l.texto, xi + 1, cy + baseLinha);
          doc.setFont("helvetica", "bold");
          doc.text(l.valor, xi + W - 1, cy + baseLinha, { align: "right" });
          doc.setTextColor(...COR.texto);
        }
        cy += LT;
      }
      if (pintar) {
        doc.setDrawColor(...COR.linha);
        doc.setLineWidth(0.1);
        doc.rect(xi, topoTch, W, cy - topoTch);
      }
    }

    // ------------------------------ quadros: áreas, progresso, produção e TCH médio
    const meia = (W - 1.6) / 2;
    const quadro = (bx, by, bh, fundo, rotulo, valor, fonteValor, yValor) => {
      caixa(bx, by, meia, bh, fundo);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(F.rotulo);
      doc.setTextColor(...COR.apoio);
      doc.text(rotulo, bx + meia - 1.6, by + 3.4, { align: "right" });
      doc.setFont("helvetica", "bold");
      doc.setFontSize(fonteValor);
      doc.setTextColor(...COR.texto);
      doc.text(valor, bx + meia - 1.6, by + yValor, { align: "right" });
    };
    cy += 2.4;
    if (pintar) {
      quadro(xi, cy, 9, COR.alternada, "Área da ordem", `${fmtHa(m.areaTotalHa)} ha`, F.valor, 7.4);
      quadro(xi + meia + 1.6, cy, 9, COR.alternada, "Área colhida", `${fmtHa(areaColhidaHa)} ha`, F.valor, 7.4);
    }
    cy += 9 + 1.6;

    if (pintar) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(F.rotulo);
      doc.setTextColor(...COR.apoio);
      doc.text("Progresso da colheita", xi, cy + 2.4);
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...COR.texto);
      doc.text(`${progresso}%`, xi + W, cy + 2.4, { align: "right" });
      doc.setFillColor(...COR.linha);
      doc.roundedRect(xi, cy + 3.4, W, 1.8, 0.9, 0.9, "F");
      if (progresso > 0) {
        doc.setFillColor(...COR.realizado);
        doc.roundedRect(xi, cy + 3.4, Math.max((W * progresso) / 100, 1.8), 1.8, 0.9, 0.9, "F");
      }
    }
    cy += 5.2 + 1.6;

    const alturaQuadro = 10.4;
    if (pintar) {
      quadro(xi, cy, alturaQuadro, FUNDO.producao, "Produção no período", `${fmtT(m.entradaPeriodoT)} t`, F.producao, 8.4);
      quadro(xi + meia + 1.6, cy, alturaQuadro, COR.alternada, "TCH médio realizado", fmtTch(tchMedio), F.valor, 8.2);
      const t = tchMedio;
      const nivel =
        t > 80
          ? ["Excelente", FUNDO.verde, COR.realizado]
          : t >= 60
            ? ["Bom", FUNDO.azul, COR.grupoTexto]
            : t >= 40
              ? ["Médio", FUNDO.amarelo, COR.aviso]
              : ["Baixo", FUNDO.vermelho, COR.critico];
      // selo à esquerda do valor, na mesma linha
      selo(nivel[0], xi + meia + 1.6 + 1.2, cy + 8.1, nivel[1], nivel[2]);
    }
    cy += alturaQuadro;

    if (ordem.tipoCana) {
      cy += 1.8;
      if (pintar) {
        const queimada = ordem.tipoCana.toLowerCase().includes("queimada");
        selo(ordem.tipoCana.toUpperCase(), xi, cy + 2.9, queimada ? FUNDO.amarelo : FUNDO.azul, queimada ? COR.aviso : COR.grupoTexto, false, W);
      }
      cy += 4.1;
    }

    // ------------------------------ rodapé: clima (Zeus)
    if (temClima && clima) {
      cy += 2.4;
      const topoClima = cy;
      if (pintar) {
        // fundo cinza até a base do card, acompanhando o canto arredondado de baixo à direita
        const fx = x + faixa + 0.1;
        const fy = topoClima + 0.1;
        const fw = largura - faixa - 0.2;
        const fh = y + altura - topoClima - 0.2;
        doc.setFillColor(...COR.alternada);
        doc.roundedRect(fx, fy, fw, fh, RAIO - 0.1, RAIO - 0.1, "F");
        doc.rect(fx, fy, fw, Math.min(fh, RAIO), "F");
        doc.rect(fx, fy, RAIO, fh, "F");
        doc.setDrawColor(...COR.linha);
        doc.setLineWidth(0.2);
        doc.line(x + faixa, topoClima, x + largura, topoClima);
      }
      cy += 3.4;
      if (pintar) {
        doc.setFont("helvetica", "bold");
        doc.setFontSize(F.climaRotulo);
        doc.setTextColor(...COR.apoio);
        doc.text("CLIMA · ZEUS", xi, cy);
        const larguraTitulo = doc.getTextWidth("CLIMA · ZEUS") + 2;
        doc.setFont("helvetica", "normal");
        const rot = doc.splitTextToSize(rotuloClima(clima, referencia, ultimaLeitura), W - larguraTitulo)[0];
        doc.text(rot, xi + W, cy, { align: "right" });
      }
      cy += 1.2;
      for (const [gi, { c }] of climaFazendas.entries()) {
        if (rotulosClima[gi].length) {
          if (pintar) {
            doc.setFont("helvetica", "bold");
            doc.setFontSize(F.climaRotulo);
            doc.setTextColor(...COR.azul);
            rotulosClima[gi].forEach((l, li) => doc.text(l, xi, cy + 2.6 + li * 2.6));
          }
          cy += rotulosClima[gi].length * 2.6 + 0.6;
        }
        const d = c?.dia;
        if (!c || !d) {
          if (pintar) {
            doc.setFont("helvetica", "normal");
            doc.setFontSize(F.climaRotulo);
            doc.setTextColor(...COR.apoio);
            doc.text(c ? "Sem leituras no período." : "Fazenda sem estação na Zeus.", xi, cy + 2.8);
          }
          cy += 4;
          continue;
        }
        // umidade, vento, temperatura, dia anterior e chuva do dia
        const itens = itensClima(c, clima.periodo, fmtClima);
        if (pintar) {
          itens.forEach((it, i) => {
            const ix = xi + (i % 3) * cw;
            const iy = cy + Math.floor(i / 3) * alturaLinhaClima;
            desenharIcone(doc, it.icone, ix + 1.7, iy + 2.7, it.destaque ? COR.azul : COR.apoio);
            doc.setFont("helvetica", "bold");
            doc.setFontSize(F.climaValor);
            doc.setTextColor(...COR.texto);
            doc.text(it.valor, ix + 4, iy + 3.1);
            if (it.valor !== "—" && it.unidade) {
              const wv = doc.getTextWidth(it.valor);
              doc.setFont("helvetica", "normal");
              doc.setFontSize(F.climaRotulo);
              doc.setTextColor(...COR.apoio);
              doc.text(it.unidade, ix + 4 + wv + 0.5, iy + 3.1);
            }
            doc.setFont("helvetica", "normal");
            doc.setFontSize(F.climaRotulo);
            doc.setTextColor(...COR.apoio);
            // só caracteres da fonte padrão do PDF (sem o ≥)
            doc.text(doc.splitTextToSize(it.rotulo.replace("≥", ">="), cw - 4.4)[0], ix + 4, iy + 5.8);
          });
        }
        cy += Math.ceil(itens.length / 3) * alturaLinhaClima;
        if (pintar) {
          doc.setFont("helvetica", "normal");
          doc.setFontSize(F.climaRotulo);
          doc.setTextColor(...COR.apoio);
          doc.text(`Estação ${c.pic}`, xi, cy + 1.6);
        }
        cy += 2.8;
      }
      if (pintar) doc.setTextColor(...COR.texto);
    }
    return cy + pad;
  }

  const altura = percorrer(0, 0, false);

  function desenhar(x, y) {
    // card branco de cantos arredondados com o filete do status à esquerda (verde aberta, âmbar encerrada)
    doc.setFillColor(...(aberta ? COR.realizado : AMARELO));
    doc.roundedRect(x, y, largura, altura, RAIO, RAIO, "F");
    doc.setFillColor(...COR.branco);
    doc.rect(x + faixa, y, largura - faixa, altura, "F");
    percorrer(x, y, true, altura);
    doc.setDrawColor(...COR.linha);
    doc.setLineWidth(0.2);
    doc.roundedRect(x, y, largura, altura, RAIO, RAIO, "S");
    doc.setTextColor(...COR.texto);
  }

  return { altura, desenhar };
}

/**
 * Gera o PDF completo (resumo por frente, cards de ordem em grade de 4
 * colunas — igual à tela — e resumo detalhado por ordem/fazenda com
 * gráfico) e baixa o arquivo, no padrão dos relatórios (lib/pdf-padrao).
 * Roda 100% no navegador (jsPDF), sem precisar de servidor.
 */
export async function gerarRelatorioCompletoPdf(dados) {
  const rotuloHora = dados.horaCorte === 24 ? "00:00" : `${String(dados.horaCorte).padStart(2, "0")}:00`;
  const cabecalhoPdf = {
    titulo: dados.titulo,
    subtitulo: `Safra ${dados.safraLabel} · Capinópolis-MG · Referência ${fmtDateBR(dados.referencia)}${
      dados.producaoDesde ? ` · Produção desde ${fmtDateBR(dados.producaoDesde)}` : ""
    } · Dia atual até ${rotuloHora}`,
    dataAtualizacao: dados.referencia,
    usuario: dados.nomeUsuario,
    orientacao: "landscape",
  };
  const p = await abrirPdf(cabecalhoPdf);
  // rascunho (nunca salvo) para medir as tabelas finais com o mesmo padrão de tabela antes de desenhar
  const rascunho = await abrirPdf(cabecalhoPdf);
  const { doc, larg } = p;
  const dm = (iso) => fmtDateBR(iso).slice(0, 5);

  // -------------------------------------------------------------------
  // Página 1: indicadores e resumo por frente (mesma tabela da tela)
  // -------------------------------------------------------------------
  // o dia atual só entra na coluna "Dia Atual": os demais períodos vão até o dia anterior
  const ontem = addDays(dados.referencia, -1);
  const semana = { inicio: startOfWeekMonday(dados.referencia), fim: ontem };
  const quinzena = { inicio: quinzenaRange(dados.referencia).inicio, fim: ontem };
  const mesAtual = { inicio: startOfMonth(dados.referencia), fim: ontem };
  const mesAnterior = mesAnteriorRange(dados.referencia);

  const cabecalhoResumo = [
    "Frente",
    "Ordens",
    "Área Sel.\n(ha)",
    "Área Acum.\n(ha)",
    "Safra\nacumulado",
    `Mês Anterior\n${dm(mesAnterior.inicio)}-${dm(mesAnterior.fim)}`,
    `Mês Atual\n${dm(mesAtual.inicio)}-${dm(mesAtual.fim)}`,
    `Quinzena\n${dm(quinzena.inicio)}-${dm(quinzena.fim)}`,
    `Semana\n${dm(semana.inicio)}-${dm(semana.fim)}`,
    `Dia Anterior\n${dm(addDays(dados.referencia, -1))}`,
    `Dia Atual\n${dm(dados.referencia)} até ${rotuloHora}`,
    "Dias\nEfet.",
    "Ton Média\nDia Efet.",
  ];

  // os 8 indicadores do topo da tela, na mesma grade dela (4 colunas × 2 linhas, preenchidas de cima para baixo)
  const COR_KPI = { green: "verde", amber: "amarelo", blue: "azul", red: "vermelho" };
  const itensKpi = dados.kpis.map((k) => {
    // "1.198,25 ha" -> valor em destaque e unidade ao lado, como nas telas
    const partes = /^(.*\d)\s+(ha|t)$/.exec(k.value);
    return { rotulo: k.label, valor: partes ? partes[1] : k.value, unidade: partes ? partes[2] : "", apoio: k.sub, cor: COR_KPI[k.tom] ?? "azul" };
  });
  const COLUNAS_KPI = 4;
  const linhasKpi = Math.ceil(itensKpi.length / COLUNAS_KPI);
  const gradeKpi =
    itensKpi.length % COLUNAS_KPI === 0
      ? Array.from({ length: itensKpi.length }, (_, i) => itensKpi[(i % COLUNAS_KPI) * linhasKpi + Math.floor(i / COLUNAS_KPI)])
      : itensKpi;
  let y = p.indicadores(p.topo, gradeKpi, { colunas: COLUNAS_KPI });

  const temMetas = dados.metaTotais.safra > 0 || dados.metaTotais.mesAtual > 0 || dados.metaTotais.diaAtual > 0;
  y = p.secao(
    y + 4,
    "Resumo por frente",
    temMetas
      ? `Abaixo de cada produção: meta da frente no período (t) e % atingido. Dia Atual compara com ${
          dados.horaCorte === 24 ? "a meta diária inteira" : `${dados.horaCorte}/24 da meta diária`
        } (só até ${rotuloHora}).`
      : "",
  );

  const realDoPeriodo = (r) => [r.safraT, r.mesAnteriorT, r.mesAtualT, r.quinzenaT, r.semanaT, r.diaAnteriorT, r.diaAtualT];
  const metaDoPeriodo = (m) => [m.safra, m.mesAnterior, m.mesAtual, m.quinzena, m.semana, m.diaAnterior, m.diaAtual];
  const metasLinhas = [
    ...dados.resumoFrentes.map((r) => {
      const metas = metaDoPeriodo(r.meta);
      return realDoPeriodo(r).map((real, i) => (metas[i] > 0 ? { real, meta: metas[i] } : null));
    }),
    (() => {
      const metas = metaDoPeriodo(dados.metaTotais);
      return realDoPeriodo(dados.resumoTotais).map((real, i) => (metas[i] > 0 ? { real, meta: metas[i] } : null));
    })(),
  ];

  const linhaResumo = (r) => [
    r.frente ?? "Total geral",
    String(r.ordensSelecionadas),
    fmtHa(r.areaSelecionadaHa),
    fmtHa(r.areaAcumuladaHa),
    fmtT(r.safraT),
    fmtT(r.mesAnteriorT),
    fmtT(r.mesAtualT),
    fmtT(r.quinzenaT),
    fmtT(r.semanaT),
    fmtT(r.diaAnteriorT),
    fmtT(r.diaAtualT),
    String(r.diasEfetivos),
    r.diasEfetivos > 0 ? fmtT(r.mediaDiaEfetivoT) : "–",
  ];
  const md = dados.mediaDiaria;
  const linhaMedia = [
    "Média t entregue/dia (dias com entrega)",
    "",
    "",
    "",
    ...["safra", "mesAnterior", "mesAtual", "quinzena", "semana", "diaAnterior", "diaAtual"].map((k) =>
      md[k].dias > 0 ? `${fmtT(md[k].media)}\n${md[k].dias} dia(s)` : "–",
    ),
    "",
    "",
  ];
  const indiceTotalResumo = dados.resumoFrentes.length;
  /** recuo lateral das células (o mesmo do padrão), para a meta alinhar com o número de cima */
  const recuo = 1.6;
  /** fonte (pt) da linha de meta embaixo da produção */
  const FONTE_META = 6.3;
  /** textos da linha de meta: "14.000,00 ·" em cinza e o % atingido na cor do alcance */
  const textosMeta = (m) => {
    const pct = (m.real / m.meta) * 100;
    return { pct, txtPct: `${pct.toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%`, txtMeta: `${fmtT(m.meta)} ·` };
  };
  // a linha de meta não entra na medida automática das colunas: cada coluna de produção fica pelo menos com a
  // largura dela, para a meta não invadir a coluna vizinha
  const colunasResumo = { 0: { halign: "left", fontStyle: "bold" }, 1: { halign: "right" } };
  doc.setFontSize(FONTE_META);
  for (let i = 0; i < 7; i++) {
    let maior = 0;
    for (const linha of metasLinhas) {
      if (!linha[i]) continue;
      const { txtPct, txtMeta } = textosMeta(linha[i]);
      doc.setFont("helvetica", "bold");
      const wPct = doc.getTextWidth(txtPct);
      doc.setFont("helvetica", "normal");
      maior = Math.max(maior, wPct + 0.8 + doc.getTextWidth(txtMeta));
    }
    if (maior > 0) colunasResumo[4 + i] = { minCellWidth: maior + 2 * recuo + 0.6 };
  }

  const fimResumo = p.tabela({
    startY: y + 1,
    head: [cabecalhoResumo],
    body: [...dados.resumoFrentes.map(linhaResumo), linhaResumo(dados.resumoTotais), linhaMedia],
    headStyles: { halign: "right" },
    columnStyles: colunasResumo,
    didParseCell: (data) => {
      data.cell.styles.halign = data.column.index > 0 ? "right" : "left";
      if (data.section !== "body") return;
      // linha com meta: tudo no alto da célula, para os números da linha ficarem na mesma altura (a meta vai embaixo)
      if (metasLinhas[data.row.index]?.some(Boolean)) data.cell.styles.valign = "top";
      // espaço embaixo da produção para a linha de meta desenhada em didDrawCell
      if (data.column.index >= 4 && metasLinhas[data.row.index]?.[data.column.index - 4]) {
        data.cell.styles.cellPadding = { top: 1.1, bottom: 4.6, left: recuo, right: recuo };
      }
      if (data.row.index === indiceTotalResumo) pintarTotal(data);
      else if (data.row.index === indiceTotalResumo + 1) {
        data.cell.styles.fontStyle = "bold";
        data.cell.styles.fillColor = COR.alternada;
        if (data.column.index === 0) data.cell.colSpan = 4;
      }
    },
    didDrawCell: (data) => {
      if (data.section !== "body" || data.column.index < 4) return;
      const m = metasLinhas[data.row.index]?.[data.column.index - 4];
      if (!m) return;
      const { pct, txtPct, txtMeta } = textosMeta(m);
      const naTotal = data.row.index === indiceTotalResumo;
      const xDir = data.cell.x + data.cell.width - recuo;
      const yBase = data.cell.y + data.cell.height - 1.5;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(FONTE_META);
      doc.setTextColor(...(naTotal ? COR.branco : pct >= 100 ? COR.realizado : pct >= 80 ? COR.pendente : COR.critico));
      doc.text(txtPct, xDir, yBase, { align: "right" });
      const larguraPct = doc.getTextWidth(txtPct);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...(naTotal ? COR.apoioCabecalho : COR.apoio));
      doc.text(txtMeta, xDir - larguraPct - 0.8, yBase, { align: "right" });
      doc.setTextColor(...COR.texto);
    },
  });

  // -------------------------------------------------------------------
  // Cards de ordem em grade de 4 colunas, agrupados por frente — mesmo
  // conteúdo e mesma ordem dos cards da tela.
  // -------------------------------------------------------------------
  // Seguem logo abaixo do resumo por frente, na mesma página, se couber.
  // `cursorY` é a linha de base do próximo título de seção (no topo da página, p.topo, como no padrão).
  let cursorY = fimResumo + 8;
  /** do título da frente (linha de base) até o topo dos cards */
  const ALTURA_TITULO_FRENTE = 8.2;

  const GAP = 2.5;
  const POR_LINHA = 4;
  const colWidth = (larg - MARGEM * 2 - GAP * (POR_LINHA - 1)) / POR_LINHA;

  const montarCards = (grupo) =>
    grupo.map((ordem) =>
      montarCardOrdem(
        doc,
        ordem,
        dados.period,
        dados.referencia,
        colWidth,
        {
          historico: dados.historicoTch.porOrdem[ordem.numero],
          safraAtual: dados.historicoTch.safraAtual,
          safrasAnteriores: dados.historicoTch.safrasAnteriores,
          divergenciaPct: dados.divergenciaPorOrdem[ordem.numero],
        },
        dados.clima,
      ),
    );

  /** Título da frente (em toda página em que a frente continua); deixa `cursorY` no topo dos cards. */
  function tituloFrente(texto) {
    cursorY = p.secao(cursorY, texto, `Ordens · ${dados.periodLabel}`) + 1;
  }

  for (const [frente, ordensFrente] of dados.porFrente) {
    const cards = montarCards(ordensFrente);
    // o título da frente nunca fica sozinho no fim da página: reserva também o 1º card
    cursorY = p.espaco(cursorY, ALTURA_TITULO_FRENTE + (cards[0]?.altura ?? 0) + GAP);
    tituloFrente(`${frente} — ${ordensFrente.length} ordem(ns)`);
    // cada card entra na coluna mais curta (os 4 primeiros na ordem, da esquerda para a direita):
    // um card alto não deixa buraco embaixo dos vizinhos e a página fica bem aproveitada
    let colunas = Array(POR_LINHA).fill(cursorY);
    for (const card of cards) {
      let idx = colunas.indexOf(Math.min(...colunas));
      if (colunas[idx] + card.altura > p.base && colunas[idx] > cursorY) {
        cursorY = p.novaPagina();
        tituloFrente(`${frente} (continuação)`);
        colunas = Array(POR_LINHA).fill(cursorY);
        idx = 0;
      }
      card.desenhar(MARGEM + idx * (colWidth + GAP), colunas[idx]);
      colunas[idx] += card.altura + GAP;
    }
    cursorY = Math.max(...colunas) + 6;
  }

  // -------------------------------------------------------------------
  // As duas tabelas finais (resumo detalhado e resumo diário do mês) são
  // sempre numa página só: cada uma é medida no PDF de rascunho (mesmo
  // padrão de tabela) e, se não couber, a escala (fonte e espaçamento)
  // diminui até caber.
  // -------------------------------------------------------------------
  /** Onde a tabela termina se começar em `topo` numa página nova; Infinity se passar para outra página. */
  function fimDaTabela(desenhar, escala, topo) {
    const antes = rascunho.doc.getNumberOfPages();
    rascunho.novaPagina();
    const fim = desenhar(rascunho, escala, topo);
    return rascunho.doc.getNumberOfPages() > antes + 1 ? Infinity : fim;
  }

  /** Quantas páginas a tabela ocupa se começar em `topo` numa página nova. */
  function paginasDaTabela(desenhar, escala, topo) {
    const antes = rascunho.doc.getNumberOfPages();
    rascunho.novaPagina();
    desenhar(rascunho, escala, topo);
    return rascunho.doc.getNumberOfPages() - antes;
  }

  /** Maior escala (1 = tamanho normal) em que a tabela termina até `limite`; null se nem a mínima couber. */
  function escolherEscala(desenhar, topo, limite, minima) {
    for (let e = 1; e >= minima - 1e-9; e -= 0.04) {
      if (fimDaTabela(desenhar, e, topo) <= limite) return e;
    }
    return null;
  }

  // ---------- Resumo detalhado por ordem/fazenda ----------
  const gruposDetalhado = dados.resumoDetalhadoPorFrente;
  const nDet = (x, f) => (x !== null && x > 0 ? f(x) : "–");
  // estimado · realizado · a colher · projetado (mesmas colunas da tela)
  const fmtDetalhe = (l, estimadoNoAColher = false) => [
    nDet(l.areaTotalHa, fmtHa),
    nDet(l.tchEst, fmtTch),
    nDet(l.tonEst, fmtT),
    nDet(l.areaColhidaHa, fmtHa),
    nDet(l.producaoTotalT, fmtT),
    nDet(l.tchRealParcial, fmtTch),
    nDet(l.areaAColherHa, fmtHa),
    `${nDet(l.tchAColher, fmtTch)}${estimadoNoAColher ? "*" : ""}`,
    nDet(l.tonAColher, fmtT),
    nDet(l.tonProjetada, fmtT),
    fmtDeltaPct(deltaProjetadoPct(l)),
  ];
  // blocos do cabeçalho com a cor do significado (como na tela): estimado azul, realizado verde, a colher laranja;
  // traço suave entre os blocos, como nos outros cabeçalhos em dois níveis
  const BLOCOS_DETALHE = [
    { titulo: "Estimado", cor: COR.grupoTexto, colunas: 3 },
    { titulo: "Realizado", cor: COR.realizado, colunas: 3 },
    { titulo: "A colher", cor: COR.pendente, colunas: 3 },
    { titulo: "Projetado", cor: COR.azulEscuro, colunas: 2 },
  ];
  /** coluna do Delta % da produção projetada sobre a estimada (verde ganho, vermelho perda) */
  const COL_DELTA = 14;
  const TITULO_DETALHADO = "Resumo detalhado por ordem e fazenda";
  const NOTA_DETALHADO =
    "A colher = área total da O.C. - área colhida (0 na ordem encerrada), pelo TCH parcial; sem TCH parcial, pelo TCH estimado (*). Ton projetada = produção acumulada + ton a colher.";
  /** espaço da nota embaixo da tabela */
  const ALTURA_NOTA = 6;

  const corpoDetalhado = [];
  const subtotaisDetalhado = new Set();
  for (const grupo of gruposDetalhado) {
    grupo.linhas.forEach((l, i) => {
      corpoDetalhado.push([i === 0 ? l.frente : "", l.ordem, l.fazendaCodigo, l.fazendaNome, ...fmtDetalhe(l, l.tchAColherEstimado)]);
    });
    corpoDetalhado.push([`${grupo.frente} Total`, "", "", "", ...fmtDetalhe({ ...grupo.subtotal })]);
    subtotaisDetalhado.add(corpoDetalhado.length - 1);
  }
  corpoDetalhado.push(["Total Geral", "", "", "", ...fmtDetalhe(dados.resumoDetalhadoTotalGeral)]);
  const indiceTotalGeral = corpoDetalhado.length - 1;

  /** Desenha o resumo detalhado (frentes, subtotais e total geral) com `pp.tabela`; devolve o y final. */
  function desenharDetalhado(pp, escala, topo) {
    const fonte = Math.max(6.3, 7.2 * escala);
    const pad = Math.max(0.6, 1.1 * escala);
    const numericas = {
      // frente e descrição da fazenda numa linha só (os números é que quebram o título)
      0: { minCellWidth: 26 },
      3: { minCellWidth: 44 },
    };
    for (let c = 4; c <= 14; c++) numericas[c] = { halign: "right" };
    return pp.tabela({
      startY: topo,
      head: [
        [
          { content: "", colSpan: 4 },
          ...BLOCOS_DETALHE.map((b) => ({
            content: b.titulo,
            colSpan: b.colunas,
            styles: { halign: "center", fillColor: b.cor },
          })),
        ],
        [
          "Frente",
          "Ordem",
          "Fazenda",
          "Descrição Fazenda",
          "Área Total OC (ha)",
          "TCH Est. (t/ha)",
          "Ton Est. (t)",
          "Área Colhida (ha)",
          "Produção Acum. (t)",
          "TCH Parcial (t/ha)",
          "Área a Colher (ha)",
          "TCH (t/ha)",
          "Ton (t)",
          "Ton Projetada (t)",
          "Delta % Proj. x Est.",
        ],
      ],
      body: corpoDetalhado,
      styles: { fontSize: fonte, cellPadding: pad },
      headStyles: { halign: "left" },
      columnStyles: numericas,
      // último recurso (tabela em várias páginas): o título da seção se repete no alto de cada página seguinte (a
      // seção no alto da página fica 3,3 mm abaixo de pp.topo; a tabela, 4,6 mm abaixo da seção). Embaixo fica o espaço
      // da nota (a tabela para ALTURA_NOTA acima de pp.base): ela nunca vai sozinha para outra página. Nenhuma linha se
      // parte entre duas páginas.
      margin: { top: pp.topo + 7.9, bottom: pp.alt - pp.base + ALTURA_NOTA },
      rowPageBreak: "avoid",
      willDrawPage: (d) => {
        if (d.pageNumber > 1) pp.secao(pp.topo, `${TITULO_DETALHADO} (continuação)`);
      },
      didParseCell: (data) => {
        if (data.section === "head") {
          if (data.row.index === 1 && data.column.index >= 4) data.cell.styles.halign = "right";
          return;
        }
        if (data.section !== "body") return;
        if (data.row.index === indiceTotalGeral) pintarTotal(data);
        else if (subtotaisDetalhado.has(data.row.index)) pintarSubtotal(data);
        if (data.column.index === COL_DELTA && data.row.index !== indiceTotalGeral) {
          const t = String(data.cell.raw ?? "");
          if (t.startsWith("+")) data.cell.styles.textColor = COR.realizado;
          else if (t.startsWith("-")) data.cell.styles.textColor = COR.critico;
          data.cell.styles.fontStyle = "bold";
        }
      },
      didDrawCell: (data) => separarBlocosCabecalho(data, [4, 7, 10, 13]),
    });
  }

  if (gruposDetalhado.length > 0) {
    // 1) cabe inteiro na página dos cards, no tamanho quase normal? 2) página própria;
    // 3) último recurso: segue em várias páginas (o cabeçalho do relatório e o título da seção se repetem), no menor
    //    número delas: o espaçamento das linhas desce até a escala 0,55 se isso poupar uma página (ex.: o subtotal e o
    //    total geral não ficam sozinhos na última) e, com esse número de páginas, fica a maior escala até 0,7
    const topoAqui = cursorY + 4.6;
    const sobra = p.base - ALTURA_NOTA - topoAqui;
    const escalaAqui = sobra > 30 ? escolherEscala(desenharDetalhado, topoAqui, p.base - ALTURA_NOTA, 0.8) : null;
    let fim;
    if (escalaAqui !== null) {
      p.secao(cursorY, TITULO_DETALHADO);
      fim = desenharDetalhado(p, escalaAqui, topoAqui);
    } else {
      const topoNova = p.secao(p.novaPagina(), TITULO_DETALHADO) + 1;
      let escala = escolherEscala(desenharDetalhado, topoNova, p.base - ALTURA_NOTA, 0.7);
      if (escala === null) {
        const minimo = paginasDaTabela(desenharDetalhado, 0.55, topoNova);
        escala = 0.55;
        for (let e = 0.7; e > 0.55 + 1e-9; e -= 0.03) {
          if (paginasDaTabela(desenharDetalhado, e, topoNova) <= minimo) {
            escala = e;
            break;
          }
        }
      }
      fim = desenharDetalhado(p, escala, topoNova);
    }
    p.nota(fim + 2, NOTA_DETALHADO);
  }

  // ---------- Resumo diário do mês ----------
  const rm = dados.resumoMensal;
  const tituloMensal = `Resumo diário por frente — ${rotuloMesAbrev(rm.mes)}`;
  const topoMensal = p.secao(p.novaPagina(), tituloMensal) + 1;
  const nFrentes = rm.frentes.length;
  const pct = (t, m) => (m > 0 ? `${Math.round((t / m) * 100)}%` : "");
  const corpoMensal = rm.dias.map((d) => {
    const dow = new Date(`${d.data}T00:00:00Z`).getUTCDay();
    return [
      `${fmtDateBR(d.data).slice(0, 6) + d.data.slice(2, 4)} ${["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][dow]}`,
      ...rm.frentes.map((f) => (d.futuro ? "" : d.frentes[f].t > 0 ? fmtT(d.frentes[f].t) : "–")),
      d.futuro ? "" : d.totalT > 0 ? fmtT(d.totalT) : "–",
    ];
  });
  corpoMensal.push([
    "Total do mês",
    ...rm.frentes.map((f) => `${fmtT(rm.totais[f].t)}${rm.totais[f].meta > 0 ? `  (${pct(rm.totais[f].t, rm.totais[f].meta)})` : ""}`),
    `${fmtT(rm.totalT)}${rm.totalMeta > 0 ? `  (${pct(rm.totalT, rm.totalMeta)})` : ""}`,
  ]);
  const colunasMensal = {};
  for (let c = 1; c <= nFrentes + 1; c++) colunasMensal[c] = { halign: "right" };
  const barraCor = (v) => (v >= 100 ? COR.realizado : v >= 80 ? COR.pendente : COR.critico);

  /** Desenha o resumo diário com `pp.tabela`; devolve o y final. */
  function desenharMensal(pp, escala, topo) {
    const d = pp.doc;
    const fonte = Math.max(6, 7 * escala);
    const topoCel = 0.7 * escala;
    const baseCel = Math.max(1.3, 1.9 * escala);
    return pp.tabela({
      startY: topo,
      head: [["Data", ...rm.frentes, "Total (t)"]],
      body: corpoMensal,
      styles: { fontSize: fonte, cellPadding: { top: topoCel, bottom: baseCel, left: 1.6, right: 1.6 } },
      headStyles: { cellPadding: 1.2 * escala + 0.3 },
      columnStyles: colunasMensal,
      didParseCell: (data) => {
        if (data.section === "body" && data.row.index === corpoMensal.length - 1) pintarTotal(data);
      },
      // barra do alcançado sobre a meta, no pé de cada célula de frente/total
      didDrawCell: (data) => {
        if (data.section !== "body" || data.column.index === 0) return;
        const dia = rm.dias[data.row.index];
        if (!dia || dia.futuro) return;
        const col = data.column.index;
        const real = col <= nFrentes ? dia.frentes[rm.frentes[col - 1]].t : dia.totalT;
        const meta = col <= nFrentes ? dia.frentes[rm.frentes[col - 1]].meta : dia.totalMeta;
        if (!(meta > 0)) return;
        const v = (real / meta) * 100;
        // meta do dia, sem casas decimais e em cinza de apoio, à esquerda do valor (sem passar da borda esquerda da célula)
        d.setFont("helvetica", "normal");
        d.setFontSize(fonte);
        d.setTextColor(...COR.apoio);
        const txtMeta = Math.round(meta).toLocaleString("pt-BR");
        const xMeta = Math.max(data.cell.x + data.cell.width * 0.28, data.cell.x + 1.6 + d.getTextWidth(txtMeta));
        d.text(txtMeta, xMeta, data.cell.y + topoCel + fonte * 0.3528 * 0.85, { align: "right" });
        d.setTextColor(...COR.texto);
        const largBarra = data.cell.width - 3.2;
        const yBarra = data.cell.y + data.cell.height - (baseCel - 0.4);
        d.setFillColor(...COR.linha);
        d.rect(data.cell.x + 1.6, yBarra, largBarra, 0.8, "F");
        d.setFillColor(...barraCor(v));
        d.rect(data.cell.x + 1.6, yBarra, (largBarra * Math.min(100, v)) / 100, 0.8, "F");
      },
    });
  }
  // sempre numa página só: a escala cai até a tabela caber (31 dias + total + cabeçalho)
  desenharMensal(p, escolherEscala(desenharMensal, topoMensal, p.base, 0.45) ?? 0.45, topoMensal);

  // `dataurlnewwindow` (abrir numa aba nova) depende de window.open(), que o
  // navegador silenciosamente bloqueia aqui — o import do jsPDF é
  // assíncrono, e por essa altura o clique original já não conta mais como
  // "gesto do usuário" pra maioria dos bloqueadores de pop-up. `save()`
  // baixa o arquivo direto (não é bloqueado) — o usuário abre o PDF baixado
  // pra imprimir, ou já sai imprimindo pelo próprio visualizador de PDF.
  // O rodapé padrão (empresa, quem gerou e quando, "Página X de Y") entra em todas as páginas ao salvar.
  p.salvar(`${dados.titulo}_${dados.referencia.replace(/-/g, "")}.pdf`);
}
