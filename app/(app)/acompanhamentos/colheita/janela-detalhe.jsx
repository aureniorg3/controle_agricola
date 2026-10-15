"use client";

import { BotaoExportar } from "@/app/(app)/acompanhamentos/os-agricola/comum";
import { JanelaInfo } from "@/components/janela";

/*
 * Janelas dos cards das telas de Colheita (Moagem › Dashboard e Conferência de Pesagem), no modelo de Fazenda e
 * Talhões: o card vira botão e abre o detalhe que forma o número, com os mesmos dados e filtros da tela.
 */

const nf = (n, c = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
export const int = (n) => (n ?? 0).toLocaleString("pt-BR");
export const qtd = (n, um, varios) => `${int(n)} ${n === 1 ? um : varios}`;
/** arredonda o número que vai para a planilha (área e tonelada em 3 casas, TCH e percentual em 2); vazio fica vazio */
export const r3 = (n) => (n === null || n === undefined ? null : Math.round(n * 1000) / 1000);
export const r2 = (n) => (n === null || n === undefined ? null : Math.round(n * 100) / 100);

/**
 * Valor na tela: "ha", "t" e "tch" (2 casas), "int" (contagem), "pct" (1 casa), "pct0" (sem casa, como o Real/Est.
 * do card), "var" (variação com seta), "cod" (código à direita) ou texto. Vazio é "—", como nas tabelas das telas.
 */
export function formatar(num, v) {
  if (v === null || v === undefined || v === "" || (typeof v === "number" && !Number.isFinite(v))) return "—";
  if (num === "ha" || num === "t" || num === "tch") return nf(v);
  if (num === "int") return int(v);
  if (num === "pct") return `${nf(v, 1)}%`;
  if (num === "pct0") return `${nf(v, 0)}%`;
  if (num === "var") return `${v >= 0 ? "▲" : "▼"} ${Math.abs(v).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%`;
  return v;
}

/** Percentual de `v` no `total`; sem total, nada. */
export const pct = (v, total) => (total > 0 ? (v / total) * 100 : null);

/** Card (Indicador) que abre a janela do detalhe: foco visível e "Ver o detalhe" ao passar o mouse. */
export function BotaoCartao({ onClick, title = "Ver o detalhe", className = "", children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      className={`min-w-0 rounded-xl2 text-left transition hover:-translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500 ${className}`}
    >
      {children}
    </button>
  );
}

/** Texto clicável de uma linha da janela (aplica o filtro na página). */
export function BotaoLink({ onClick, title, children }) {
  return (
    <button type="button" onClick={onClick} title={title} className="text-left text-[#2E5FA8] hover:underline">
      {children}
    </button>
  );
}

/**
 * Tabela das janelas: cabeçalho, números à direita e linha de total (fica no fim ao ordenar pelo título da coluna).
 * Coluna: { rotulo, valor(l) (o que vai para a planilha), num (ver `formatar`; qualquer um fica à direita), exibir(l)
 * (o que aparece, se diferente do valor), classe(l), dica(l), total, soPlanilha (só na exportação) }. `rotuloTotal`
 * troca o "Total" da linha de total (ex.: "Total · 12 equipamentos").
 */
export function TabelaJanela({ colunas, linhas, chave, vazio = "Nada no filtro.", rotuloTotal = "Total" }) {
  const vis = colunas.filter((c) => !c.soPlanilha);
  const inicioTotal = vis.findIndex((c) => c.total !== undefined);
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="whitespace-nowrap border-b border-line bg-surface text-left text-muted">
            {vis.map((c) => (
              <th key={c.rotulo} className={`px-3 py-2 font-medium ${c.num ? "text-right" : ""}`}>
                {c.rotulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={chave(l)} className="border-t border-line/60 hover:bg-surface/60">
              {vis.map((c) => (
                <td
                  key={c.rotulo}
                  className={`px-3 py-1.5 ${c.num ? "whitespace-nowrap text-right tabular" : ""} ${c.classe?.(l) ?? "text-ink"}`}
                  title={c.dica?.(l)}
                >
                  {c.exibir ? c.exibir(l) : formatar(c.num, c.valor(l))}
                </td>
              ))}
            </tr>
          ))}
          {linhas.length === 0 && (
            <tr>
              <td colSpan={vis.length} className="px-4 py-8 text-center text-muted">
                {vazio}
              </td>
            </tr>
          )}
          {linhas.length > 0 && inicioTotal > 0 && (
            <tr className="bg-navy-900 font-semibold text-white">
              <td colSpan={inicioTotal} className="px-3 py-2">
                {rotuloTotal}
              </td>
              {vis.slice(inicioTotal).map((c) => (
                <td key={c.rotulo} className={`px-3 py-2 ${c.num ? "whitespace-nowrap text-right tabular" : ""}`}>
                  {c.total === undefined ? "" : formatar(c.num, c.total)}
                </td>
              ))}
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Nota({ children }) {
  return <p className="mb-3 text-[12px] leading-relaxed text-muted">{children}</p>;
}

export function Secao({ titulo, acoes, children }) {
  return (
    <div className="mt-5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <div className="text-[12.5px] font-medium text-ink">{titulo}</div>
        {acoes}
      </div>
      {children}
    </div>
  );
}

/** Botão de exportar uma tabela da janela (só o rótulo e o valor de cada coluna); sem linhas, nada. */
export const exportarTabela = (prefixo, { nome, colunas, linhas }) =>
  linhas.length > 0 && (
    <BotaoExportar nome={`${prefixo} - ${nome}`} colunas={colunas.map(({ rotulo, valor }) => ({ rotulo, valor }))} buscar={async () => linhas} />
  );

/** Link do rodapé das janelas (aplicar o filtro na página, ir para a tela de origem). */
export const CLASSE_LINK_RODAPE = "rounded-md px-2 py-1 text-[12.5px] font-medium text-[#2E5FA8] hover:bg-[#2E5FA8]/[0.06]";

/**
 * Moldura das janelas: período/filtros no subtítulo e exportar a tabela principal no topo. `prefixo` abre o nome do
 * arquivo exportado (tela e safra/período, sem barras: o nome também vira o da aba da planilha).
 */
export function JanelaCard({ titulo, subtitulo, prefixo, exportar, rodape, largura = "5xl", onFechar, children }) {
  return (
    <JanelaInfo
      titulo={titulo}
      subtitulo={subtitulo}
      largura={largura}
      onFechar={onFechar}
      acoes={exportar && exportarTabela(prefixo, exportar)}
      rodape={rodape}
    >
      {children}
    </JanelaInfo>
  );
}
