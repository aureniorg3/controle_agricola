import { fmtDateBR } from "./format";
import { GRUPOS_PADRAO_ESTOQUE } from "./estoque-insumos";
import { abrirPdf, COR, pintarTotal } from "./pdf-padrao";

/** Dosagem e Disp. (ha) em destaque, como na planilha Resumo_Estoque */
const DOSAGEM = [251, 233, 220];
const HECTARES = [228, 240, 222];

const nf = (n, c = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });

/**
 * PDF do estoque (A4 paisagem), no modelo da planilha "Estoque Herbicida": Descrição, Código, Est Real, Estoque Disp,
 * Dif Real x Disp, Dosagem, Vlr Unit. e Disp. (ha), produto a produto, no padrão dos relatórios (lib/pdf-padrao).
 */
export async function gerarRelatorioEstoquePdf(d) {
  const soHerbicidas =
    !!d.grupos?.length && d.grupos.every((g) => GRUPOS_PADRAO_ESTOQUE.includes(g)) && GRUPOS_PADRAO_ESTOQUE.every((g) => d.grupos.includes(g));
  const nome = soHerbicidas ? "Estoque Herbicida" : "Estoque de Insumos";
  const p = await abrirPdf({
    titulo: `${nome} – Safra ${d.dt.slice(0, 4)}`,
    subtitulo: `CRV Industrial Ltda · Unidade Capinópolis-MG · ${d.empresasTexto} · ${d.gruposTexto}`,
    dataAtualizacao: d.dt,
    usuario: d.nomeUsuario,
  });

  const corpo = d.linhas.map((l) => [
    l.ds,
    l.principioAtivo || "–",
    l.cod,
    nf(l.est),
    nf(l.disp),
    nf(l.dif),
    l.dose === null ? "–" : `${nf(l.dose, 3)}${l.doseOrigem === "dosagens" ? "*" : ""}`,
    l.vlrUnit === null ? "–" : `R$ ${nf(l.vlrUnit)}`,
    l.ha === null ? "–" : nf(l.ha),
  ]);
  // total no fim, somando cada coluna como na planilha (inclusive dosagem e valor unitário)
  const soma = (f) => d.linhas.reduce((s, l) => s + (f(l) ?? 0), 0);
  const nTotal = corpo.length;
  corpo.push([
    "Total",
    "",
    "",
    nf(soma((l) => l.est)),
    nf(soma((l) => l.disp)),
    nf(soma((l) => l.dif)),
    nf(soma((l) => l.dose)),
    `R$ ${nf(soma((l) => l.vlrUnit))}`,
    nf(soma((l) => l.ha)),
  ]);

  const fim = p.tabela({
    startY: p.topo,
    head: [["Descrição", "Princípio Ativo", "Código", "Est Real", "Estoque Disp", "Dif Real x Disp", "Dosagem", "Vlr Unit.", "Disp. (ha)"]],
    body: corpo,
    styles: { fontSize: 8 },
    headStyles: { fontSize: 8 },
    columnStyles: {
      0: { cellWidth: 62, halign: "left" },
      1: { cellWidth: 70, halign: "left", fontSize: 7.2 },
      2: { cellWidth: 17, halign: "center" },
      3: { halign: "right" },
      4: { halign: "right" },
      5: { halign: "right" },
      6: { halign: "right", fillColor: DOSAGEM },
      7: { halign: "right", cellWidth: 24 },
      8: { halign: "right", fillColor: HECTARES, fontStyle: "bold" },
    },
    didParseCell: (c) => {
      if (c.section === "head") {
        if (c.column.index <= 1) c.cell.styles.halign = "left";
        return;
      }
      if (c.row.index === nTotal) return pintarTotal(c);
      // as colunas em destaque mantêm a cor em todas as linhas
      if (c.column.index === 6) c.cell.styles.fillColor = DOSAGEM;
      // sem dosagem (ou sem estoque) não há hectares para destacar
      if (c.column.index === 8) {
        if ((d.linhas[c.row.index].ha ?? 0) > 0) c.cell.styles.fillColor = HECTARES;
        else c.cell.styles.fontStyle = "normal";
      }
      if (c.column.index === 1) c.cell.styles.textColor = COR.apoio;
      if (c.column.index === 5 && Math.abs(d.linhas[c.row.index].dif) >= 0.005) {
        c.cell.styles.textColor = COR.critico;
        c.cell.styles.fontStyle = "bold";
      }
    },
  });

  p.nota(fim + 2, [
    // só caracteres da fonte padrão do PDF (sem ÷, › e −)
    "Disp. (ha) = estoque real / dosagem por hectare. Dif Real x Disp = estoque disponível - estoque real (em vermelho quando há diferença).",
    `Dosagem da planilha de estoque; com *, do cadastro Insumos > Dosagens. Dados de ${fmtDateBR(d.dt)}.`,
  ]);
  p.salvar(`${nome}_${d.dt.replace(/-/g, "")}.pdf`);
}
