"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { fmtHa, fmtT, fmtTch } from "@/lib/format";

import { ehBooleano, ehTexto, usarPersistido } from "@/lib/usar-persistido";
import BotaoLimparFiltros from "@/components/BotaoLimparFiltros";
import { IconHistorico } from "@/components/icons";
import { Abas, CabecalhoPagina, Comando, CorpoPagina, EstadoVazio, Indicador, Pagina, Painel } from "@/components/pagina";
import { BotaoCartao, BotaoLink, CLASSE_LINK_RODAPE, JanelaCard, Nota, pct, qtd, r2, r3, TabelaJanela } from "./janela-detalhe";

const DIMENSOES = [
  { key: "fazenda", label: "Fazenda", coluna: "Fazenda" },
  { key: "proprietario", label: "Proprietário", coluna: "Proprietário" },
  { key: "municipio", label: "Município", coluna: "Município" },
  { key: "variedade", label: "Variedade", coluna: "Variedade" },
  { key: "corte", label: "Corte", coluna: "Corte" },
];

const FILTRO = "rounded-md border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink focus:border-brand-600 focus:outline-none";
const LIMITE = 200;
const HISTORICO = "/acompanhamentos/colheita/historico-safras";
/** tabela "TCH Realizado por …" da página (o clique num nome dentro das janelas leva até ela) */
const ID_TABELA_DIMENSAO = "colheita-tch-dimensao";

function variacao(atual, anterior) {
  if (atual === null || anterior === null || anterior <= 0) return null;
  return ((atual - anterior) / anterior) * 100;
}

function Variacao({ valor }) {
  if (valor === null) return <span className="text-muted">—</span>;
  const cor = valor >= 0 ? "text-good-600" : "text-alert-600";
  return (
    <span className={`font-semibold ${cor}`}>
      {valor >= 0 ? "▲" : "▼"} {Math.abs(valor).toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%
    </span>
  );
}

export default function ColheitaPainelClient({ safras, dimensoes, variedadeCorte }) {
  const [dim, setDim] = usarPersistido("colheita.dimensao", "fazenda", ehTexto);
  const [busca, setBusca] = usarPersistido("colheita.busca", "", ehTexto);
  const [verTudo, setVerTudo] = usarPersistido("colheita.verTudo", false, ehBooleano);
  const algumFiltroAtivo = busca !== "" || verTudo !== false;
  function limparFiltros() {
    setBusca("");
    setVerTudo(false);
  }
  /** janela (detalhe) do card aberta: area, producao, tchReal, tchEst */
  const [janela, setJanela] = useState(null);
  // clique num nome dentro da janela: a tabela "TCH Realizado por …" passa a mostrar só ele (agrupamento e busca dela)
  function mostrarNaTabela(dimensao, chave) {
    setDim(dimensao);
    setBusca(chave);
    setVerTudo(false);
    setJanela(null);
    setTimeout(() => document.getElementById(ID_TABELA_DIMENSAO)?.scrollIntoView({ behavior: "smooth", block: "start" }), 0);
  }

  const anos = useMemo(() => safras.map((s) => s.safra).sort((a, b) => a - b), [safras]);
  const ultima = anos[anos.length - 1];
  const anterior = anos.length > 1 ? anos[anos.length - 2] : undefined;
  const porAno = useMemo(() => new Map(safras.map((s) => [s.safra, s])), [safras]);

  const maxTch = Math.max(1, ...safras.flatMap((s) => [s.tchReal ?? 0, s.tchEst ?? 0]));

  const pivot = useMemo(() => {
    const mapa = new Map();
    for (const r of dimensoes[dim]) {
      const linha = mapa.get(r.chave) ?? new Map();
      linha.set(r.safra, r);
      mapa.set(r.chave, linha);
    }
    const termo = busca.trim().toLowerCase();
    return Array.from(mapa.entries())
      .filter(([chave]) => !termo || chave.toLowerCase().includes(termo))
      .map(([chave, linha]) => ({
        chave,
        linha,
        producaoUltima: ultima !== undefined ? (linha.get(ultima)?.producaoT ?? 0) : 0,
        areaUltima: ultima !== undefined ? (linha.get(ultima)?.areaTot ?? 0) : 0,
      }))
      .sort((a, b) => b.areaUltima - a.areaUltima || a.chave.localeCompare(b.chave));
  }, [dimensoes, dim, busca, ultima]);

  const visiveis = verTudo ? pivot : pivot.slice(0, LIMITE);
  const dimInfo = DIMENSOES.find((d) => d.key === dim);

  return (
    <Pagina>
      <CabecalhoPagina
        titulo="Dashboard"
        categoria="Moagem"
        comandos={
          <Comando href="/acompanhamentos/colheita/historico-safras" icone={<IconHistorico size={16} />}>
            Histórico de Safras
          </Comando>
        }
      />

      <CorpoPagina>
        {safras.length === 0 ? (
          <Painel semEspaco>
            <EstadoVazio titulo="Nenhuma safra importada ainda.">
              Importe os relatórios em{" "}
              <Link href="/acompanhamentos/colheita/historico-safras" className="font-semibold text-brand-700">
                Histórico de Safras
              </Link>{" "}
              para ver os comparativos.
            </EstadoVazio>
          </Painel>
        ) : (
          <>
            {/* cada card abre a janela com o detalhe do número (a safra aberta por fazenda, variedade…) */}
            <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {ultima !== undefined && (
                <>
                  <Kpi cor="azul" titulo={`Safra ${ultima} · Área Total (ha)`} valor={fmtHa(porAno.get(ultima).areaTot)} onAbrir={() => setJanela("area")} />
                  <Kpi cor="azul" titulo={`Safra ${ultima} · Produção (t)`} valor={fmtT(porAno.get(ultima).producaoT)} onAbrir={() => setJanela("producao")} />
                  <Kpi
                    onAbrir={() => setJanela("tchReal")}
                    cor="verde"
                    titulo={`Safra ${ultima} · TCH Realizado (t/ha)`}
                    valor={porAno.get(ultima).tchReal !== null ? fmtTch(porAno.get(ultima).tchReal) : "—"}
                    extra={
                      anterior !== undefined ? (
                        <>
                          vs {anterior}: <Variacao valor={variacao(porAno.get(ultima).tchReal, porAno.get(anterior).tchReal)} />
                        </>
                      ) : null
                    }
                  />
                  <Kpi
                    onAbrir={() => setJanela("tchEst")}
                    cor="cinza"
                    titulo={`Safra ${ultima} · TCH Estimado (t/ha)`}
                    valor={porAno.get(ultima).tchEst !== null ? fmtTch(porAno.get(ultima).tchEst) : "—"}
                    extra={
                      porAno.get(ultima).tchEst && porAno.get(ultima).tchReal ? (
                        <>
                          Real/Est.:{" "}
                          <b>{((porAno.get(ultima).tchReal / porAno.get(ultima).tchEst) * 100).toLocaleString("pt-BR", { maximumFractionDigits: 0 })}%</b>
                        </>
                      ) : null
                    }
                  />
                </>
              )}
            </div>

            <div className="mb-5 grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_1fr]">
              <Painel titulo="Comparativo por safra" semEspaco>
                <div className="overflow-x-auto">
                  <table className="w-full text-[12.5px]">
                    <thead>
                      <tr className="border-b border-line bg-surface text-left text-muted">
                        <th className="px-4 py-2 font-semibold">Safra</th>
                        <th className="px-3 py-2 text-right font-semibold">Área Total (ha)</th>
                        <th className="px-3 py-2 text-right font-semibold">Produção (t)</th>
                        <th className="px-3 py-2 text-right font-semibold">TCH Realizado (t/ha)</th>
                        <th className="px-3 py-2 text-right font-semibold">TCH Estimado (t/ha)</th>
                        <th className="px-4 py-2 text-right font-semibold">Variação TCH</th>
                      </tr>
                    </thead>
                    <tbody>
                      {[...anos].reverse().map((ano, idx, lista) => {
                        const r = porAno.get(ano);
                        const ant = lista[idx + 1] !== undefined ? porAno.get(lista[idx + 1]) : undefined;
                        return (
                          <tr key={ano} className="border-b border-line last:border-0">
                            <td className="px-4 py-1.5 font-semibold text-ink">{ano}</td>
                            <td className="px-3 py-1.5 text-right tabular text-ink">{fmtHa(r.areaTot)}</td>
                            <td className="px-3 py-1.5 text-right tabular text-ink">{fmtT(r.producaoT)}</td>
                            <td className="px-3 py-1.5 text-right font-semibold tabular text-ink">{r.tchReal !== null ? fmtTch(r.tchReal) : "—"}</td>
                            <td className="px-3 py-1.5 text-right tabular text-muted">{r.tchEst !== null ? fmtTch(r.tchEst) : "—"}</td>
                            <td className="px-4 py-1.5 text-right tabular">
                              <Variacao valor={ant ? variacao(r.tchReal, ant.tchReal) : null} />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Painel>

              <Painel
                titulo="TCH por safra (t/ha)"
                semEspaco
                acoes={
                  <span className="flex items-center gap-3 text-[11px] text-muted">
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-sm bg-navy-900" /> Realizado
                    </span>
                    <span className="flex items-center gap-1">
                      <span className="h-2 w-2 rounded-sm bg-amber-500" /> Estimado
                    </span>
                  </span>
                }
              >
                <div className="space-y-2.5 px-4 py-3">
                  {anos.map((ano) => {
                    const r = porAno.get(ano);
                    return (
                      <div key={ano} className="flex items-center gap-3 text-[12px]">
                        <span className="w-10 font-semibold text-ink">{ano}</span>
                        <div className="flex-1 space-y-1">
                          <Barra valor={r.tchReal} max={maxTch} cor="bg-navy-900" />
                          <Barra valor={r.tchEst} max={maxTch} cor="bg-amber-500" />
                        </div>
                      </div>
                    );
                  })}
                </div>
              </Painel>
            </div>

            <VariedadesSecao anos={anos} variedades={dimensoes.variedade} variedadeCorte={variedadeCorte} />

            <Painel
              id={ID_TABELA_DIMENSAO}
              titulo={`TCH Realizado (t/ha) por ${dimInfo.label}`}
              semEspaco
              acoes={
                <>
                  <select
                    value={dim}
                    onChange={(e) => {
                      setDim(e.target.value);
                      setVerTudo(false);
                    }}
                    aria-label="Agrupar por"
                    className={FILTRO}
                  >
                    {DIMENSOES.map((d) => (
                      <option key={d.key} value={d.key}>
                        Por {d.label}
                      </option>
                    ))}
                  </select>
                  <input
                    value={busca}
                    onChange={(e) => setBusca(e.target.value)}
                    placeholder={`Buscar ${dimInfo.label.toLowerCase()}…`}
                    className={`${FILTRO} min-w-[220px]`}
                  />
                  <BotaoLimparFiltros ativo={algumFiltroAtivo} onLimpar={limparFiltros} />
                  <span className="ml-1.5 text-[12px] text-muted">
                    {pivot.length} {pivot.length === 1 ? "linha" : "linhas"}
                  </span>
                </>
              }
            >
              <div className="overflow-x-auto">
                <table className="w-full text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface text-left text-muted">
                      <th className="px-4 py-2 font-semibold">{dimInfo.coluna}</th>
                      {dim === "fazenda" && <th className="px-3 py-2 font-semibold">Descrição Fazenda</th>}
                      <th className="px-3 py-2 text-right font-semibold">Área {ultima} (ha)</th>
                      {anos.map((ano) => (
                        <th key={ano} className="px-3 py-2 text-right font-semibold">
                          TCH {ano} (t/ha)
                        </th>
                      ))}
                      {ultima !== undefined && anterior !== undefined && (
                        <th className="px-4 py-2 text-right font-semibold">
                          Variação {ultima} x {anterior}
                        </th>
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {visiveis.map((l) => (
                      <tr key={l.chave} className="border-b border-line last:border-0">
                        {dim === "fazenda" ? (
                          <>
                            <td className="px-4 py-1.5 font-semibold tabular text-ink">{l.chave.split(" - ")[0] || "—"}</td>
                            <td className="px-3 py-1.5 text-ink">{l.chave.split(" - ").slice(1).join(" - ")}</td>
                          </>
                        ) : (
                          <td className="px-4 py-1.5 font-semibold text-ink">{l.chave || "—"}</td>
                        )}
                        <td className="px-3 py-1.5 text-right tabular text-ink">{l.areaUltima > 0 ? fmtHa(l.areaUltima) : "—"}</td>
                        {anos.map((ano) => {
                          const v = l.linha.get(ano)?.tchReal ?? null;
                          return (
                            <td key={ano} className="px-3 py-1.5 text-right tabular text-ink">
                              {v !== null ? fmtTch(v) : "—"}
                            </td>
                          );
                        })}
                        {ultima !== undefined && anterior !== undefined && (
                          <td className="px-4 py-1.5 text-right tabular">
                            <Variacao valor={variacao(l.linha.get(ultima)?.tchReal ?? null, l.linha.get(anterior)?.tchReal ?? null)} />
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!verTudo && pivot.length > LIMITE && (
                <div className="border-t border-line bg-surface px-4 py-2 text-center text-[12.5px]">
                  Mostrando {LIMITE} de {pivot.length}.{" "}
                  <button type="button" onClick={() => setVerTudo(true)} className="font-semibold text-brand-700">
                    Mostrar todas
                  </button>
                </div>
              )}
            </Painel>
          </>
        )}
      </CorpoPagina>
      {janela && ultima !== undefined && (
        <JanelaSafra
          tipo={janela}
          safra={ultima}
          anterior={anterior}
          porAno={porAno}
          dimensoes={dimensoes}
          dimInicial={dim}
          onFechar={() => setJanela(null)}
          onChave={mostrarNaTabela}
        />
      )}
    </Pagina>
  );
}

/* ---------- Janelas dos cards: o número da safra aberto pelas mesmas bases da página ---------- */

/** O que cada card mostra: título, nome no arquivo exportado e a medida que ordena as linhas. */
const CARDS_SAFRA = {
  area: { titulo: "Área Total (ha)", nome: "Área Total", ordem: "areaTot" },
  producao: { titulo: "Produção (t)", nome: "Produção", ordem: "producaoT" },
  tchReal: { titulo: "TCH Realizado (t/ha)", nome: "TCH Realizado", ordem: "areaColhida" },
  tchEst: { titulo: "TCH Estimado (t/ha)", nome: "TCH Estimado", ordem: "areaTot" },
};
const ABAS_DIMENSAO = DIMENSOES.map((d) => ({ id: d.key, label: `Por ${d.label}` }));
const MUTED = () => "text-muted";
const FORTE = () => "font-semibold text-ink";

/**
 * Janela de um card da safra: o número aberto por fazenda, proprietário, município, variedade ou corte (abas; abre no
 * agrupamento escolhido na tabela da página). Os cards somam a safra inteira, então a janela também (a busca da
 * tabela da página não entra) e a linha de total é a do card. Clicar no nome mostra só ele na tabela "TCH Realizado
 * por …" da página.
 */
function JanelaSafra({ tipo, safra, anterior, porAno, dimensoes, dimInicial, onFechar, onChave }) {
  const [aba, setAba] = useState(DIMENSOES.some((d) => d.key === dimInicial) ? dimInicial : "fazenda");
  const card = CARDS_SAFRA[tipo];
  const dimInfo = DIMENSOES.find((d) => d.key === aba);
  const total = porAno.get(safra);
  const totalAnt = anterior !== undefined ? porAno.get(anterior) : undefined;

  const linhas = useMemo(() => {
    const todas = dimensoes[aba];
    const doAnterior = new Map(todas.filter((r) => r.safra === anterior).map((r) => [r.chave, r]));
    // a busca da tabela procura o texto dentro do nome: só filtra pelo nome que não está contido em outro
    const chaves = Array.from(new Set(todas.map((r) => r.chave.toLowerCase())));
    const filtravel = (chave) => {
      const termo = chave.trim().toLowerCase();
      return termo !== "" && chaves.filter((c) => c.includes(termo)).length === 1;
    };
    return todas
      .filter((r) => r.safra === safra)
      .map((r) => {
        const tchAnterior = doAnterior.get(r.chave)?.tchReal ?? null;
        return {
          ...r,
          tchAnterior,
          variacao: variacao(r.tchReal, tchAnterior),
          realEst: r.tchReal !== null && r.tchEst ? (r.tchReal / r.tchEst) * 100 : null,
          filtravel: filtravel(r.chave),
        };
      })
      .sort((a, b) => (aba === "corte" ? Number(a.chave) - Number(b.chave) : b[card.ordem] - a[card.ordem] || a.chave.localeCompare(b.chave)));
  }, [dimensoes, aba, safra, anterior, card.ordem]);

  const nomeFazenda = (l) => l.chave.split(" - ").slice(1).join(" - ");
  const botao = (l, texto) =>
    l.filtravel ? (
      <BotaoLink onClick={() => onChave(aba, l.chave)} title={`Mostrar só ${texto} na tabela TCH Realizado por ${dimInfo.label} da página`}>
        {texto}
      </BotaoLink>
    ) : (
      texto
    );
  const colChave =
    aba === "fazenda"
      ? [
          { rotulo: "Fazenda", valor: (l) => l.chave.split(" - ")[0], classe: () => "font-medium tabular text-ink" },
          { rotulo: "Descrição Fazenda", valor: nomeFazenda, exibir: (l) => botao(l, nomeFazenda(l) || l.chave) },
        ]
      : [
          {
            rotulo: dimInfo.coluna,
            valor: (l) => (aba === "corte" ? Number(l.chave) : l.chave),
            exibir: (l) => botao(l, l.chave || `(sem ${dimInfo.label.toLowerCase()})`),
            classe: () => "font-medium text-ink",
          },
        ];

  const colAreaTot = { rotulo: "Área Total (ha)", num: "ha", valor: (l) => r3(l.areaTot), total: total.areaTot };
  const colAreaCol = { rotulo: "Área Colhida (ha)", num: "ha", valor: (l) => r3(l.areaColhida), total: total.areaColhida };
  const colProd = { rotulo: "Produção (t)", num: "t", valor: (l) => r3(l.producaoT), total: total.producaoT };
  const colTchReal = { rotulo: "TCH Realizado (t/ha)", num: "tch", valor: (l) => r2(l.tchReal), total: total.tchReal };
  const colunas = [
    ...colChave,
    ...{
      area: [
        { ...colAreaTot, classe: FORTE },
        { rotulo: "% da área", num: "pct", valor: (l) => r2(pct(l.areaTot, total.areaTot)), total: total.areaTot > 0 ? 100 : null, classe: MUTED },
        { ...colAreaCol, classe: MUTED },
      ],
      producao: [
        colAreaCol,
        { ...colProd, classe: FORTE },
        { rotulo: "% da produção", num: "pct", valor: (l) => r2(pct(l.producaoT, total.producaoT)), total: total.producaoT > 0 ? 100 : null, classe: MUTED },
        { ...colTchReal, classe: MUTED },
      ],
      tchReal: [
        colAreaCol,
        colProd,
        { ...colTchReal, classe: FORTE },
        ...(totalAnt
          ? [
              { rotulo: `TCH ${anterior} (t/ha)`, num: "tch", valor: (l) => r2(l.tchAnterior), total: totalAnt.tchReal, classe: MUTED },
              {
                rotulo: `Variação ${safra} x ${anterior}`,
                num: "var",
                valor: (l) => r2(l.variacao),
                exibir: (l) => <Variacao valor={l.variacao} />,
                total: variacao(total.tchReal, totalAnt.tchReal),
              },
            ]
          : []),
      ],
      tchEst: [
        colAreaTot,
        { rotulo: "Produção Estimada (t)", num: "t", valor: (l) => r3(l.producaoEstT), total: total.producaoEstT },
        { rotulo: "TCH Estimado (t/ha)", num: "tch", valor: (l) => r2(l.tchEst), total: total.tchEst, classe: FORTE },
        { ...colTchReal, classe: MUTED },
        {
          rotulo: "Real/Est.",
          num: "pct0",
          valor: (l) => r2(l.realEst),
          total: total.tchReal !== null && total.tchEst ? (total.tchReal / total.tchEst) * 100 : null,
          classe: MUTED,
        },
      ],
    }[tipo],
  ];

  const regra = {
    area: "Área total dos talhões da safra no Histórico de Safras.",
    producao: "Produção realizada dos talhões já colhidos (com produção) e a área colhida deles; TCH = produção ÷ área colhida.",
    tchReal:
      "TCH Realizado = produção ÷ área colhida, só dos talhões já colhidos (com produção). A linha de total é o TCH da safra (produção total ÷ área colhida total), não a média das linhas.",
    tchEst:
      "TCH Estimado = produção estimada ÷ área total de todos os talhões (inclusive os sem estimativa); fica em branco sem produção estimada. Real/Est. = TCH Realizado ÷ TCH Estimado.",
  }[tipo];

  return (
    <JanelaCard
      titulo={card.titulo}
      subtitulo={`Safra ${safra} · por ${dimInfo.label} · safra inteira (a busca da tabela da página não entra nos cards)`}
      prefixo={`Moagem Dashboard - Safra ${safra}`}
      exportar={{ nome: `${card.nome} por ${dimInfo.label}`, colunas, linhas }}
      onFechar={onFechar}
      rodape={
        <>
          <span className="mr-auto text-[11.5px] text-muted">Base: relatórios de safra importados em Histórico de Safras.</span>
          <Link href={HISTORICO} className={CLASSE_LINK_RODAPE}>
            Ver em Histórico de Safras
          </Link>
        </>
      }
    >
      <Nota>
        {regra} {qtd(linhas.length, "linha", "linhas")}; clique no nome para ver só ele na tabela TCH Realizado por {dimInfo.label} da página.
      </Nota>
      <Abas itens={ABAS_DIMENSAO} ativo={aba} onChange={setAba} className="mb-3" />
      <TabelaJanela colunas={colunas} linhas={linhas} chave={(l) => l.chave} vazio={`Nenhuma linha na safra ${safra}.`} />
    </JanelaCard>
  );
}

/** Variedades de uma safra: participação na área, produção, TCH e variação; e o
 * TCH de cada variedade por corte. */
function VariedadesSecao({ anos, variedades, variedadeCorte }) {
  const [safra, setSafra] = useState(anos[anos.length - 1]);
  const anoAnterior = useMemo(() => {
    const menores = anos.filter((a) => a < safra);
    return menores.length > 0 ? menores[menores.length - 1] : undefined;
  }, [anos, safra]);

  const linhas = useMemo(() => {
    const doAno = variedades.filter((v) => v.safra === safra);
    const total = doAno.reduce((s, v) => s + v.areaTot, 0);
    const anterior = new Map(variedades.filter((v) => v.safra === anoAnterior).map((v) => [v.chave, v]));
    return doAno
      .map((v) => ({
        ...v,
        pctArea: total > 0 ? (v.areaTot / total) * 100 : 0,
        anterior: anterior.get(v.chave)?.tchReal ?? null,
      }))
      .sort((a, b) => b.areaTot - a.areaTot);
  }, [variedades, safra, anoAnterior]);

  const cortes = useMemo(
    () => Array.from(new Set(variedadeCorte.filter((v) => v.safra === safra).map((v) => v.corte))).sort((a, b) => a - b),
    [variedadeCorte, safra],
  );
  const matriz = useMemo(() => {
    const mapa = new Map();
    for (const v of variedadeCorte.filter((x) => x.safra === safra)) {
      const linha = mapa.get(v.variedade) ?? new Map();
      linha.set(v.corte, v);
      mapa.set(v.variedade, linha);
    }
    return linhas.map((l) => ({ chave: l.chave, linha: mapa.get(l.chave) ?? new Map() }));
  }, [variedadeCorte, safra, linhas]);

  return (
    <Painel
      className="mb-5"
      titulo="Variedades da safra"
      semEspaco
      acoes={
        <>
          <select value={safra} onChange={(e) => setSafra(Number(e.target.value))} aria-label="Safra" className={FILTRO}>
            {[...anos].reverse().map((a) => (
              <option key={a} value={a}>
                Safra {a}
              </option>
            ))}
          </select>
          <span className="ml-1.5 text-[12px] text-muted">
            {linhas.length} variedade{linhas.length === 1 ? "" : "s"}
          </span>
        </>
      }
    >
      <div className="max-h-[420px] overflow-auto">
        <table className="w-full text-[12.5px]">
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-line text-left text-muted">
              <th className="px-4 py-2 font-semibold">Variedade</th>
              <th className="px-3 py-2 text-right font-semibold">Área Total (ha)</th>
              <th className="px-3 py-2 font-semibold">% da Área</th>
              <th className="px-3 py-2 text-right font-semibold">Produção (t)</th>
              <th className="px-3 py-2 text-right font-semibold">TCH Realizado (t/ha)</th>
              <th className="px-3 py-2 text-right font-semibold">TCH Estimado (t/ha)</th>
              {anoAnterior !== undefined && (
                <>
                  <th className="px-3 py-2 text-right font-semibold">TCH {anoAnterior} (t/ha)</th>
                  <th className="px-4 py-2 text-right font-semibold">Variação</th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {linhas.map((l) => (
              <tr key={l.chave} className="border-b border-line last:border-0">
                <td className="px-4 py-1.5 font-semibold text-ink">{l.chave || "(sem variedade)"}</td>
                <td className="px-3 py-1.5 text-right tabular text-ink">{fmtHa(l.areaTot)}</td>
                <td className="px-3 py-1.5">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-24 overflow-hidden rounded-full bg-surface">
                      <div className="h-full rounded-full bg-navy-900" style={{ width: `${Math.min(100, l.pctArea)}%` }} />
                    </div>
                    <span className="w-12 text-right text-[11.5px] tabular text-muted">{l.pctArea.toLocaleString("pt-BR", { maximumFractionDigits: 1 })}%</span>
                  </div>
                </td>
                <td className="px-3 py-1.5 text-right tabular text-ink">{fmtT(l.producaoT)}</td>
                <td className="px-3 py-1.5 text-right font-semibold tabular text-ink">{l.tchReal !== null ? fmtTch(l.tchReal) : "—"}</td>
                <td className="px-3 py-1.5 text-right tabular text-muted">{l.tchEst !== null ? fmtTch(l.tchEst) : "—"}</td>
                {anoAnterior !== undefined && (
                  <>
                    <td className="px-3 py-1.5 text-right tabular text-muted">{l.anterior !== null ? fmtTch(l.anterior) : "—"}</td>
                    <td className="px-4 py-1.5 text-right tabular">
                      <Variacao valor={variacao(l.tchReal, l.anterior)} />
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cortes.length > 0 && (
        <>
          <div className="border-y border-line bg-surface px-4 py-2 text-[13px] font-bold text-ink">
            TCH Realizado (t/ha) por Variedade e Corte — safra {safra}
          </div>
          <div className="max-h-[360px] overflow-auto">
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-surface">
                <tr className="border-b border-line text-left text-muted">
                  <th className="px-4 py-2 font-semibold">Variedade</th>
                  {cortes.map((c) => (
                    <th key={c} className="px-3 py-2 text-right font-semibold">
                      {c}º Corte
                      <div className="font-normal normal-case text-muted/70">TCH · área (ha)</div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {matriz.map((m) => (
                  <tr key={m.chave} className="border-b border-line last:border-0">
                    <td className="px-4 py-1.5 font-semibold text-ink">{m.chave || "(sem variedade)"}</td>
                    {cortes.map((c) => {
                      const v = m.linha.get(c);
                      return (
                        <td key={c} className="px-3 py-1.5 text-right tabular text-ink">
                          {v && v.tchReal !== null ? (
                            <>
                              <b>{fmtTch(v.tchReal)}</b>
                              <span className="ml-1.5 text-[11px] text-muted">{fmtHa(v.areaTot)}</span>
                            </>
                          ) : v ? (
                            <span className="text-[11px] text-muted">— {fmtHa(v.areaTot)}</span>
                          ) : (
                            "—"
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Painel>
  );
}

/** Card da safra: abre a janela com o detalhe do número (o título inteiro aparece ao passar o mouse). */
function Kpi({ titulo, valor, extra, cor, onAbrir }) {
  return (
    <BotaoCartao onClick={onAbrir} title={`${titulo} · ver o detalhe`}>
      <Indicador cor={cor} rotulo={titulo} valor={valor} apoio={extra || undefined} className="h-full" />
    </BotaoCartao>
  );
}

function Barra({ valor, max, cor }) {
  return (
    <div className="flex items-center gap-2">
      <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-surface">
        {valor !== null && <div className={`h-full rounded-full ${cor}`} style={{ width: `${(valor / max) * 100}%` }} />}
      </div>
      <span className="w-12 text-right text-[11px] tabular text-muted">{valor !== null ? fmtTch(valor) : "—"}</span>
    </div>
  );
}
