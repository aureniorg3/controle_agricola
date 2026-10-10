import { fmtDateBR } from "./format";
import { hectaresDoSaldo, nomeEmpresa, precoMedio, textoDosagem, textoHectares } from "./insumos-saldo";
import { abrirPdf, COR, pintarSinal, pintarSubcabecalho, pintarSubtotal, pintarTotal, separarBlocosCabecalho } from "./pdf-padrao";

/** Bloco "Total" do cabeçalho no mesmo laranja da tela (#D77B38); o bloco "Aplicação" fica no verde CRV. */
const LARANJA = [215, 123, 56];

const nf = (n, c = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
const cel = (n, c = 2) => (Math.abs(n) < 0.0005 ? "" : nf(n, c));
const rs = (n) => (Math.abs(n) < 0.0005 ? "" : `R$ ${nf(n)}`);

/**
 * PDF "Acompanhamento Saldo de Insumos" (A4 paisagem): matriz Grupo → Insumo por empresa, total e movimentação diária,
 * no padrão dos relatórios (lib/pdf-padrao).
 */
export async function gerarRelatorioSaldoPdf(d) {
  const titulo = "Acompanhamento Saldo de Insumos";
  const p = await abrirPdf({
    titulo,
    subtitulo: "CRV Industrial · Unidade Capinópolis/MG · Saldo de Insumos Agrícolas",
    dataAtualizacao: d.dtBase,
    usuario: d.nomeUsuario,
  });

  const { colunas, grupos } = d.matriz;
  const tresCels = (c) => (c ? [cel(c.qtd), cel(precoMedio(c)), rs(c.valor)] : ["", "", ""]);

  const cab1 = [{ content: `Data base: ${fmtDateBR(d.dtBase)}`, colSpan: 5, styles: { halign: "left" } }];
  for (const c of colunas) cab1.push({ content: `${c.rotulo}${c.sub ? ` · ${c.sub}` : ""}`, colSpan: 3, styles: { halign: "center" } });
  cab1.push({ content: "Total", colSpan: 3, styles: { halign: "center", fillColor: LARANJA } });
  cab1.push({ content: "Aplicação", colSpan: 2, styles: { halign: "center", fillColor: COR.verde } });
  const sub = ["Grupo", "Código", "Descrição do insumo", "Princípio ativo", "UM"];
  for (let i = 0; i < colunas.length + 1; i++) sub.push("Qtd", "Preço médio", "Vl. total");
  sub.push("Dosagem /ha", "Hectares");

  // tipo de cada linha e, nos insumos, se é a linha par do grupo (zebrado recomeça em cada grupo)
  const tipos = [];
  const pares = [];
  const corpo = [];
  for (const g of grupos) {
    g.itens.forEach((it, i) => {
      const dos = d.dosagens[it.cod];
      corpo.push([
        i === 0 ? g.grp.trim() : "",
        it.cod,
        it.ds,
        d.principios?.[it.cod] || "–",
        it.un.trim(),
        ...colunas.flatMap((c) => tresCels(it.cels[c.chave])),
        ...tresCels(it.total),
        textoDosagem(dos) || "–",
        textoHectares(hectaresDoSaldo(it.total.qtd, dos)) || "–",
      ]);
      tipos.push("item");
      pares.push(i % 2 === 1);
    });
    corpo.push([
      `${g.grp.trim()} · ${g.grpDs.trim()} — total`,
      "",
      "",
      "",
      "",
      ...colunas.flatMap((c) => tresCels(g.cels[c.chave])),
      ...tresCels(g.total),
      "",
      "",
    ]);
    tipos.push("subtotal");
    pares.push(false);
  }
  // Total geral no rodapé da tabela, só na última página: o autoTable leva junto a última linha do corpo, e o total
  // nunca fica sozinho numa folha
  const totalGeral = ["Total geral", "", "", "", "", ...colunas.flatMap((c) => tresCels(d.matriz.cels[c.chave])), ...tresCels(d.matriz.total), "", ""];

  const nCol = 5 + (colunas.length + 1) * 3 + 2;
  const iniTotal = 5 + colunas.length * 3; // primeira coluna do bloco Total
  // colunas onde começa cada bloco do cabeçalho (empresas, Total e Aplicação): traço suave entre os blocos
  const iniciosBlocos = [...colunas.map((_, i) => 5 + i * 3), iniTotal, iniTotal + 3];
  // separado por depósito há 4 ou mais blocos de empresa: letra menor e colunas de texto mais estreitas
  const muitas = colunas.length > 2;
  const lado = muitas ? 0.8 : 1;
  // larguras: cada número numa linha só (sem quebrar "R$ 1.234,56") quando cabe; Descrição e Princípio ativo ficam com
  // o que sobra. Se não couber, as duas ficam no mínimo e a tabela reparte o resto: o "R$" desce de linha e os números
  // não se partem enquanto couber a maior palavra de cada coluna (com 3 ou mais depósitos separados a matriz passa da
  // largura do A4 e números longos podem partir).
  const fixas = muitas ? { 0: 11, 1: 12, 4: 7 } : { 0: 14, 1: 15, 4: 9 };
  const fonte = muitas ? 5.6 : 6.3;
  p.doc.setFont("helvetica", "bold");
  p.doc.setFontSize(fonte);
  const largura = (t) => p.doc.getTextWidth(String(t ?? ""));
  // mínimo das colunas de texto: a maior palavra inteira (nunca partir "CLORANTRANILIPROLE")
  const folga = 2 * lado + 0.4;
  const maiorPalavra = (i) => Math.max(...corpo.map((r, k) => (tipos[k] === "item" ? Math.max(...String(r[i]).split(" ").map(largura)) : 0))) + folga;
  const minDesc = Math.max(muitas ? 26 : 34, maiorPalavra(2));
  const minPrinc = Math.max(muitas ? 20 : 26, maiorPalavra(3));
  const numeros = [];
  for (let i = 5; i < nCol; i++) numeros.push(Math.max(...[...corpo, totalGeral].map((r) => largura(r[i])), ...sub[i].split(" ").map(largura)) + folga);
  const sobra = p.larg - 2 * p.margem - fixas[0] - fixas[1] - fixas[4] - numeros.reduce((a, b) => a + b, 0);
  const cabe = sobra >= minDesc + minPrinc;
  const desc = cabe ? Math.max(minDesc, Math.min(sobra * 0.56, sobra - minPrinc)) : minDesc;
  const colStyles = {
    0: { cellWidth: fixas[0] },
    1: { cellWidth: fixas[1] },
    2: { cellWidth: desc },
    3: { cellWidth: cabe ? sobra - desc : minPrinc },
    4: { cellWidth: fixas[4] },
  };
  for (let i = 5; i < nCol; i++) colStyles[i] = cabe ? { halign: "right", cellWidth: numeros[i - 5] } : { halign: "right" };

  p.tabela({
    startY: p.topo,
    head: [cab1, sub],
    body: corpo,
    foot: [totalGeral],
    showFoot: "lastPage",
    styles: { fontSize: fonte, cellPadding: { top: 0.8, bottom: 0.8, left: lado, right: lado } },
    headStyles: { fontSize: fonte, halign: "right" },
    columnStyles: colStyles,
    rowPageBreak: "avoid",
    didParseCell: (c) => {
      const col = c.column.index;
      if (c.section === "head") {
        // 1ª linha (blocos): azul escuro, menos Total (laranja) e Aplicação (verde), que têm cor própria
        if (c.row.index === 0 && col < iniTotal) pintarSubcabecalho(c);
        if (col < 5) c.cell.styles.halign = "left";
        return;
      }
      const t = c.section === "foot" ? "total" : tipos[c.row.index];
      if (t === "subtotal" || t === "total") {
        if (t === "total") pintarTotal(c);
        else pintarSubtotal(c);
        if (col === 0) c.cell.colSpan = 5;
        // o rodapé não recebe o columnStyles: alinhamento à mão
        c.cell.styles.halign = col < 5 ? "left" : "right";
        return;
      }
      c.cell.styles.fillColor = pares[c.row.index] ? COR.alternada : COR.branco;
      if (col === 0) {
        c.cell.styles.fontStyle = "bold";
        c.cell.styles.textColor = COR.azul;
      } else if (col === 3 || col >= nCol - 2) {
        // princípio ativo e, sem dosagem, o traço: cinza de apoio
        if (col === 3 || c.cell.raw === "–") c.cell.styles.textColor = COR.apoio;
        else if (col === nCol - 1) c.cell.styles.fontStyle = "bold";
      } else if (col >= 5) {
        if (col >= iniTotal) c.cell.styles.fontStyle = "bold";
        // saldo negativo em vermelho
        if (/^(R\$ )?-/.test(String(c.cell.raw))) c.cell.styles.textColor = COR.critico;
      }
    },
    // cabeçalho em dois níveis: traço suave separa os blocos de empresa, o Total e a Aplicação
    didDrawCell: (c) => separarBlocosCabecalho(c, iniciosBlocos),
  });

  // Movimentação diária (R$) numa página própria: cabe sempre, mesmo com o resumo em várias folhas
  const mov = d.movimento;
  if (mov.datas.length > 0) {
    const y = p.secao(p.novaPagina(), "Movimentação diária (R$)", "Variação do valor em estoque sobre o retrato anterior");
    const fmtDelta = (v) => (v === null ? "–" : Math.abs(v) < 0.005 ? "0,00" : nf(v));
    const nome = (l) => `${nomeEmpresa(l.emp)}${l.almx !== null ? ` · ${l.almx}` : ""}`;
    const deltas = mov.lista.map((l) => mov.datas.map((x) => mov.delta(l.valores, x)));
    p.tabela({
      startY: y + 1,
      head: [["Empresa", ...mov.datas.map((x) => fmtDateBR(x).slice(0, 5))]],
      body: [
        ...mov.lista.map((l, i) => [nome(l), ...deltas[i].map(fmtDelta)]),
        ["Total", ...mov.datas.map((x) => fmtDelta(mov.delta(mov.totalPorData, x)))],
      ],
      columnStyles: { 0: { halign: "left", cellWidth: 40 } },
      didParseCell: (c) => {
        c.cell.styles.halign = c.column.index > 0 ? "right" : "left";
        if (c.section !== "body") return;
        if (c.row.index === mov.lista.length) return pintarTotal(c);
        if (c.column.index === 0) {
          c.cell.styles.fontStyle = "bold";
          return;
        }
        // variação: alta em verde, queda em vermelho; sem retrato anterior ou sem variação, cinza
        const v = deltas[c.row.index][c.column.index - 1];
        if (v === null || Math.abs(v) < 0.005) c.cell.styles.textColor = COR.apoio;
        else pintarSinal(c, v);
      },
    });
  }

  p.salvar(`${titulo}_${d.dtBase.replace(/-/g, "")}.pdf`);
}
