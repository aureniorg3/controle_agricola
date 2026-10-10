import { STATUS_CONFERENCIA_LABEL } from "./conferencia";
import { fmtDateBR, fmtT } from "./format";
import { abrirPdf, COR, pintarTotal } from "./pdf-padrao";

const TITULO = "Conferência de Pesagem";

/**
 * Cor do texto do status (a mesma dos selos da tela): OK verde, frente divergente vermelho, ordem a conferir amarelo
 * escuro (o amber-600 da tela, #9A6A00), sem cadastro cinza.
 */
const COR_STATUS = {
  ok: COR.realizado,
  "frente-divergente": COR.critico,
  "ordem-outra-frente": COR.aviso,
  "sem-ordem": COR.aviso,
  "sem-cadastro": COR.apoio,
};

const CABECALHO = [
  "Data",
  "Equipamento",
  "Descrição",
  "Frente (Relatório)",
  "Frente (Cadastro)",
  "Fazenda",
  "Descrição Fazenda",
  "Ordem",
  "Frente (Ordem)",
  "Status Ordem",
  "Toneladas (t)",
  "Status",
  "Equipamento (Correção)",
  "Frente (Correção)",
];

function linhaTabela(l) {
  return [
    fmtDateBR(l.data),
    l.eqp,
    l.eqpNome,
    l.frente,
    l.frenteCadastro ?? "—",
    l.fazendaCodigo,
    l.fazendaNomeExibido,
    l.ordemNumero ?? "—",
    l.ordemFrente ?? "—",
    l.ordemStatus ?? "—",
    fmtT(l.toneladas),
    STATUS_CONFERENCIA_LABEL[l.conferencia],
    l.frenteCorrecao ? l.eqp : "",
    l.frenteCorrecao ?? "",
  ];
}

/** PDF da conferência (A4 paisagem) no padrão dos relatórios (lib/pdf-padrao): a tabela da tela, linha a linha, com o total geral. */
export async function gerarConferenciaPdf(dados) {
  const p = await abrirPdf({
    titulo: TITULO,
    subtitulo: dados.filtrosTexto || "Todos os registros importados",
    usuario: dados.nomeUsuario,
  });

  const totalT = dados.linhas.reduce((s, l) => s + l.toneladas, 0);

  p.tabela({
    startY: p.topo,
    head: [CABECALHO],
    body: [
      ...dados.linhas.map(linhaTabela),
      [
        { content: "Total geral", colSpan: 10, styles: { halign: "left" } },
        { content: fmtT(totalT), styles: { halign: "right" } },
        { content: "", colSpan: 3 },
      ],
    ],
    styles: { fontSize: 7, cellPadding: { top: 1.2, bottom: 1.2, left: 1.4, right: 1.4 } },
    headStyles: { fontSize: 7 },
    // a linha não se parte entre duas páginas
    rowPageBreak: "avoid",
    columnStyles: { 0: { halign: "center" }, 5: { halign: "center" }, 7: { halign: "center" }, 10: { halign: "right" } },
    didParseCell: (d) => {
      if (d.section !== "body") return;
      if (d.row.index === dados.linhas.length) return pintarTotal(d);
      const l = dados.linhas[d.row.index];
      const col = d.column.index;
      // como na tela: equipamento e toneladas em destaque, descrição e status da ordem em cinza, status na cor do significado
      if (col === 1 || col === 10 || col === 12) d.cell.styles.fontStyle = "bold";
      if (col === 2 || col === 9) d.cell.styles.textColor = COR.apoio;
      if (col === 11) {
        d.cell.styles.textColor = COR_STATUS[l.conferencia] ?? COR.texto;
        d.cell.styles.fontStyle = "bold";
      }
    },
  });

  p.salvar(`${TITULO}.pdf`);
}

export async function gerarConferenciaXlsx(dados) {
  const XLSX = await import("xlsx");
  const aoa = [
    [TITULO],
    [dados.filtrosTexto || "Todos os registros importados"],
    [],
    CABECALHO,
    ...dados.linhas.map((l) => [
      fmtDateBR(l.data),
      l.eqp,
      l.eqpNome,
      l.frente,
      l.frenteCadastro ?? "",
      l.fazendaCodigo,
      l.fazendaNomeExibido,
      l.ordemNumero ?? "",
      l.ordemFrente ?? "",
      l.ordemStatus ?? "",
      Math.round(l.toneladas * 1000) / 1000,
      STATUS_CONFERENCIA_LABEL[l.conferencia],
      l.frenteCorrecao ? l.eqp : "",
      l.frenteCorrecao ?? "",
    ]),
  ];
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws["!cols"] = [10, 12, 30, 22, 22, 34, 9, 18, 12, 14, 20, 20, 20].map((wch) => ({ wch }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Conferência");
  XLSX.writeFile(wb, `${TITULO}.xlsx`);
}
