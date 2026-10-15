"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import { BotaoCartao, BotaoLink, JanelaCard, Nota, Secao, TabelaJanela, corVariacao, exportarTabela, int, pct } from "@/app/(app)/acompanhamentos/insumos/janela-detalhe";
import BotaoLimparFiltros from "@/components/BotaoLimparFiltros";
import { IconImportar, IconImprimir } from "@/components/icons";
import { BarraFiltros, CabecalhoPagina, Comando, CorpoPagina, Indicador, Pagina } from "@/components/pagina";
import { GRUPOS_PADRAO_ESTOQUE, totaisEstoque } from "@/lib/estoque-insumos";
import { fmtDateBR } from "@/lib/format";
import { EMPRESAS, nomeEmpresa } from "@/lib/insumos-saldo";
import { podeEditar } from "@/lib/permissoes";

import { ehTexto, usarPersistido } from "@/lib/usar-persistido";

const FILTRO = "rounded-md border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink focus:border-brand-600 focus:outline-none";
const nf = (n, c = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
const brl = (n) => `R$ ${nf(n)}`;
const cel = (n, c = 2) => (n === null || Math.abs(n) < 0.0005 ? "–" : nf(n, c));
const GRUPOS_PADRAO = GRUPOS_PADRAO_ESTOQUE.join(",");

/** Insumos › Estoque Insumos: retrato do estoque físico por data (como o Resumo_Estoque da planilha), com histórico e PDF. */
export default function EstoqueClient({ perfil, nomeUsuario }) {
  const [dt, setDt] = useState("");
  const [emp, setEmp] = usarPersistido("estoque.emp", "", ehTexto);
  const [grupos, setGrupos] = usarPersistido("estoque.grupos", GRUPOS_PADRAO, ehTexto);
  const [busca, setBusca] = usarPersistido("estoque.busca", "", ehTexto);
  const [termo, setTermo] = useState("");
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [importar, setImportar] = useState(false);
  const [versao, setVersao] = useState(0);
  const [gerandoPdf, setGerandoPdf] = useState(false);
  /** janela (detalhe) do card aberta: valor, hectares, produtos, diferenca */
  const [janela, setJanela] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setTermo(busca), 300);
    return () => clearTimeout(t);
  }, [busca]);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    const p = new URLSearchParams();
    if (dt) p.set("dt", dt);
    if (emp) p.set("emp", emp);
    if (grupos) p.set("grp", grupos);
    if (termo.trim()) p.set("q", termo.trim());
    fetch(`/api/insumos/estoque?${p}`, { cache: "no-store" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ativo) return;
        if (!ok) return setErro(j.error ?? "Não foi possível carregar o estoque.");
        setErro(null);
        setDados(j);
      })
      .catch(() => ativo && setErro("Não foi possível carregar o estoque."))
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [dt, emp, grupos, termo, versao]);

  const selecionados = grupos ? grupos.split(",") : [];
  const alternarGrupo = (g) =>
    setGrupos((atual) => {
      const s = new Set(atual ? atual.split(",") : []);
      if (s.has(g)) s.delete(g);
      else s.add(g);
      return [...s].sort().join(",");
    });
  const linhas = dados?.linhas ?? [];
  const tot = totaisEstoque(linhas);
  const comDif = linhas.filter((l) => Math.abs(l.dif) >= 0.0005).length;
  const filtroAtivo = !!(dt || emp || grupos !== GRUPOS_PADRAO || busca);
  const empresasTexto = emp ? nomeEmpresa(Number(emp)) : `Empresas ${(dados?.empresas ?? []).map(nomeEmpresa).join(" + ") || "—"}`;
  const gruposTexto = selecionados.length ? `Grupos ${selecionados.join(", ")}` : "Todos os grupos";

  // janelas dos cards: a data, as empresas, os grupos e a busca que formaram os números; clicar no grupo dentro da
  // janela deixa a página só com ele
  const fechar = () => setJanela(null);
  const baseJanela = {
    subtitulo: [dados?.dt ? fmtDateBR(dados.dt) : "—", empresasTexto, gruposTexto, termo.trim() && `busca “${termo.trim()}”`].filter(Boolean).join(" · "),
    prefixo: `Estoque Insumos ${dados?.dt ?? ""}`.trim(),
    onFechar: fechar,
    onGrupo: (g) => {
      setGrupos(g);
      fechar();
    },
  };

  async function gerarPdf() {
    if (!dados?.dt) return;
    setGerandoPdf(true);
    try {
      const { gerarRelatorioEstoquePdf } = await import("@/lib/relatorio-estoque-pdf");
      await gerarRelatorioEstoquePdf({ dt: dados.dt, dtAnterior: dados.dtAnterior, linhas, empresasTexto, gruposTexto, grupos: selecionados, nomeUsuario });
    } finally {
      setGerandoPdf(false);
    }
  }

  return (
    <Pagina>
      <CabecalhoPagina
        titulo="Estoque Insumos"
        categoria="Insumos"
        info={dados?.ultimaImportacao && <span>Última importação {dados.ultimaImportacao}</span>}
        comandos={
          <>
            {podeEditar(perfil) && (
              <Comando primario icone={<IconImportar size={16} />} onClick={() => setImportar(true)}>
                Importar estoque
              </Comando>
            )}
            <Comando icone={<IconImprimir size={16} />} onClick={gerarPdf} disabled={!dados?.dt || gerandoPdf || linhas.length === 0}>
              {gerandoPdf ? "Gerando…" : "Gerar PDF"}
            </Comando>
          </>
        }
      />

      <CorpoPagina>
        <BarraFiltros>
          <label className="flex flex-col gap-1 text-[11.5px] text-muted">
            Data do relatório
            <select value={dados?.dt ?? dt} onChange={(e) => setDt(e.target.value)} className={FILTRO}>
              {(dados?.datas ?? []).map((d, i) => (
                <option key={d} value={d}>
                  {fmtDateBR(d)}
                  {i === 0 ? " (mais recente)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] text-muted">
            Empresa
            <select value={emp} onChange={(e) => setEmp(e.target.value)} className={FILTRO}>
              <option value="">Todas (somadas)</option>
              {EMPRESAS.map((e) => (
                <option key={e.id} value={String(e.id)}>
                  {e.id} · {e.nome}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] text-muted">
            Buscar
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Produto ou código" className={`${FILTRO} w-[200px]`} />
          </label>
          <div className="flex flex-col gap-1 text-[11.5px] text-muted">
            Grupos
            <div className="flex flex-wrap gap-1.5">
              {(dados?.grupos ?? []).map((g) => {
                const on = selecionados.includes(g.grp);
                return (
                  <button
                    key={g.grp}
                    type="button"
                    onClick={() => alternarGrupo(g.grp)}
                    title={g.ds || g.grp}
                    className={`rounded-full border px-2.5 py-1 text-[11.5px] ${on ? "border-[#2E5FA8] bg-[#2E5FA8] text-white" : "border-line bg-card text-ink hover:bg-surface"}`}
                  >
                    {g.grp}
                    {g.ds ? ` · ${g.ds}` : ""}
                  </button>
                );
              })}
              {selecionados.length === 0 && <span className="py-1 text-[11.5px] text-muted">Todos os grupos</span>}
            </div>
          </div>
          <BotaoLimparFiltros
            ativo={filtroAtivo}
            onLimpar={() => {
              setDt("");
              setEmp("");
              setGrupos(GRUPOS_PADRAO);
              setBusca("");
              setTermo("");
            }}
          />
        </BarraFiltros>

        {erro && <p className="mb-3 rounded-md border border-alert-500/40 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-700">{erro}</p>}

        {/* cada card abre a janela com o detalhe dos mesmos números (mesmos filtros) */}
        {dados?.dt && (
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <BotaoCartao onClick={() => setJanela("valor")}>
              <Indicador cor="azul" rotulo="Valor em estoque" valor={brl(tot.vr)} apoio={`${fmtDateBR(dados.dt)} · ${empresasTexto}`} className="h-full" />
            </BotaoCartao>
            <BotaoCartao onClick={() => setJanela("hectares")}>
              <Indicador
                cor="verde"
                rotulo="Hectares (estoque ÷ dose)"
                valor={nf(tot.ha)}
                unidade="ha"
                apoio="Soma dos produtos com dosagem"
                className="h-full"
              />
            </BotaoCartao>
            <BotaoCartao onClick={() => setJanela("produtos")}>
              <Indicador cor="cinza" rotulo="Produtos" valor={String(linhas.length)} apoio={gruposTexto} className="h-full" />
            </BotaoCartao>
            <BotaoCartao onClick={() => setJanela("diferenca")}>
              <Indicador
                cor={comDif > 0 ? "laranja" : "verde"}
                rotulo="Real × disponível"
                valor={comDif ? `${comDif} com diferença` : "Sem diferença"}
                apoio={`Diferença total ${nf(tot.dif, 3)}`}
                className="h-full"
              />
            </BotaoCartao>
          </div>
        )}

        <div className={`overflow-hidden rounded-xl2 border border-line bg-card shadow-card transition-opacity ${carregando ? "opacity-60" : ""}`}>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-surface text-left text-muted">
                  <th className="px-3 py-2 font-medium">Código</th>
                  <th className="px-3 py-2 font-medium">Descrição</th>
                  <th className="px-3 py-2 font-medium" title="Do cadastro Material e Insumos (aba Insumos)">
                    Princípio Ativo
                  </th>
                  <th className="px-3 py-2 text-center font-medium">UN</th>
                  <th className="px-3 py-2 text-right font-medium">Est. Real</th>
                  <th className="px-3 py-2 text-right font-medium">Estoque Disp.</th>
                  <th className="px-3 py-2 text-right font-medium">Dif. Real × Disp.</th>
                  <th className="px-3 py-2 text-right font-medium">Dosagem /ha</th>
                  <th className="px-3 py-2 text-right font-medium">Vlr Unit.</th>
                  <th className="px-3 py-2 text-right font-medium">Vlr Total</th>
                  <th className="px-3 py-2 text-right font-medium">Hectares</th>
                  <th className="px-3 py-2 text-right font-medium" title="Disponível desta data menos o da data anterior com relatório">
                    Var. disp.{dados?.dtAnterior ? ` × ${fmtDateBR(dados.dtAnterior).slice(0, 5)}` : ""}
                  </th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => {
                  const novoGrupo = i === 0 || linhas[i - 1].grp !== l.grp;
                  const variacao = l.dispAnterior === null ? null : l.disp - l.dispAnterior;
                  return (
                    <Fragment key={l.cod}>
                      {novoGrupo && (
                        <tr className="border-t border-line bg-[#2E5FA8]/[0.07]">
                          <td colSpan={12} className="px-3 py-1.5 text-[12px] font-semibold text-[#2E5FA8]">
                            {l.grp.trim()}
                            {l.grpDs ? ` · ${l.grpDs}` : ""}
                          </td>
                        </tr>
                      )}
                      <tr className="border-t border-line/60">
                        <td className="px-3 py-1.5 tabular text-muted">{l.cod}</td>
                        <td className="px-3 py-1.5 text-ink">{l.ds}</td>
                        <td className="max-w-[260px] px-3 py-1.5 text-[12px] text-muted">{l.principioAtivo || "–"}</td>
                        <td className="px-3 py-1.5 text-center text-muted">{l.un}</td>
                        <td className="px-3 py-1.5 text-right tabular text-ink">{cel(l.est, 3)}</td>
                        <td className="px-3 py-1.5 text-right tabular text-ink">{cel(l.disp, 3)}</td>
                        <td className={`px-3 py-1.5 text-right tabular ${Math.abs(l.dif) >= 0.0005 ? "font-medium text-amber-700" : "text-muted"}`}>
                          {cel(l.dif, 3)}
                        </td>
                        <td
                          className="px-3 py-1.5 text-right tabular text-ink"
                          title={l.doseOrigem === "dosagens" ? "Do cadastro Insumos › Dosagens (sem dose na planilha)" : undefined}
                        >
                          {l.dose === null ? "–" : nf(l.dose, 3)}
                          {l.doseOrigem === "dosagens" && <span className="text-muted">*</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right tabular text-muted">{l.vlrUnit === null ? "–" : brl(l.vlrUnit)}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-right tabular text-ink">{brl(l.vr)}</td>
                        <td className="px-3 py-1.5 text-right tabular font-medium text-ink">{cel(l.ha)}</td>
                        <td
                          className={`px-3 py-1.5 text-right tabular ${variacao === null || Math.abs(variacao) < 0.0005 ? "text-muted" : variacao < 0 ? "text-[#BE3132]" : "text-good-700"}`}
                        >
                          {variacao === null ? "–" : `${variacao > 0 ? "+" : ""}${cel(variacao, 3)}`}
                        </td>
                      </tr>
                    </Fragment>
                  );
                })}
                {linhas.length > 0 && (
                  <tr className="border-t border-line bg-navy-900 font-semibold text-white">
                    <td className="px-3 py-1.5" colSpan={4}>
                      Total geral
                    </td>
                    <td className="px-3 py-1.5 text-right tabular">{nf(tot.est, 3)}</td>
                    <td className="px-3 py-1.5 text-right tabular">{nf(tot.disp, 3)}</td>
                    <td className="px-3 py-1.5 text-right tabular">{nf(tot.dif, 3)}</td>
                    <td />
                    <td />
                    <td className="whitespace-nowrap px-3 py-1.5 text-right tabular">{brl(tot.vr)}</td>
                    <td className="px-3 py-1.5 text-right tabular">{nf(tot.ha)}</td>
                    <td />
                  </tr>
                )}
                {!carregando && linhas.length === 0 && (
                  <tr>
                    <td colSpan={12} className="px-4 py-10 text-center text-muted">
                      {dados?.datas.length
                        ? "Nenhum produto no filtro."
                        : 'Nenhum estoque importado. Use "Importar estoque" com o Relatório de Estoque Físico.'}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <p className="mt-2 text-[11.5px] text-muted">
          Hectares = estoque real ÷ dosagem. A dosagem é a da planilha de estoque; com *, do cadastro Insumos › Dosagens (produto sem dose na planilha). Dif. =
          disponível − real. Histórico até 08/10/2026 carregado da planilha (lançado como empresa 5); daí em diante, cada importação grava a empresa e a data do
          relatório.
        </p>
      </CorpoPagina>

      {dados?.dt && janela === "valor" && <JanelaValor linhas={linhas} tot={tot} base={baseJanela} />}
      {dados?.dt && janela === "hectares" && <JanelaHectares linhas={linhas} tot={tot} base={baseJanela} />}
      {dados?.dt && janela === "produtos" && <JanelaProdutos linhas={linhas} tot={tot} base={baseJanela} />}
      {dados?.dt && janela === "diferenca" && <JanelaDiferenca linhas={linhas} tot={tot} base={baseJanela} />}

      {importar && (
        <ImportarEstoque
          onFechar={(importou) => {
            setImportar(false);
            if (importou) {
              setDt("");
              setVersao((v) => v + 1);
            }
          }}
        />
      )}
    </Pagina>
  );
}

/* ---------- Janelas dos cards: o detalhe calculado das mesmas linhas do relatório (mesmos filtros) que formam o card ---------- */

/** Linhas do relatório somadas por grupo, na ordem do relatório. */
function somarPorGrupo(linhas) {
  const m = new Map();
  for (const l of linhas) {
    const g = m.get(l.grp) ?? { grp: l.grp, grpDs: l.grpDs, produtos: 0, vr: 0 };
    g.produtos += 1;
    g.vr += l.vr;
    m.set(l.grp, g);
  }
  return Array.from(m.values());
}

const colGrupo = (onGrupo) => ({
  rotulo: "Grupo",
  valor: (l) => l.grp.trim(),
  exibir: (l) => (
    <BotaoLink onClick={() => onGrupo(l.grp)} title={`Mostrar na página só o grupo ${l.grp.trim()}${l.grpDs ? ` · ${l.grpDs}` : ""}`}>
      {l.grp.trim()}
    </BotaoLink>
  ),
});
// um código pode vir em dois grupos (o relatório agrupa por grupo e código)
const chaveProduto = (l) => `${l.grp}|${l.cod}`;
const colCodigo = { rotulo: "Código", valor: (l) => l.cod, classe: () => "tabular text-muted" };
const colDescricao = { rotulo: "Descrição", valor: (l) => l.ds };
const colUn = { rotulo: "UN", valor: (l) => l.un, classe: () => "text-muted" };
const colReal = { rotulo: "Est. Real", num: "qtd", valor: (l) => l.est };
const colDisp = { rotulo: "Estoque Disp.", num: "qtd", valor: (l) => l.disp };

/** Tabela por grupo (produtos e valor), com o clique no grupo filtrando a página. */
function colunasPorGrupo(onGrupo, linhas, tot) {
  return [
    colGrupo(onGrupo),
    { rotulo: "Descrição do grupo", valor: (g) => g.grpDs },
    { rotulo: "Produtos", num: "int", valor: (g) => g.produtos, total: linhas.length },
    { rotulo: "Vlr Total (R$)", num: "dec", valor: (g) => g.vr, total: tot.vr, classe: () => "font-medium text-ink" },
    { rotulo: "% do total", num: "pct", valor: (g) => pct(g.vr, tot.vr), total: tot.vr > 0 ? 100 : null, classe: () => "text-muted" },
  ];
}

/** Card Valor em estoque: o valor de cada grupo e de cada produto, do maior para o menor. */
function JanelaValor({ linhas, tot, base }) {
  const grupos = useMemo(() => somarPorGrupo(linhas), [linhas]);
  const produtos = useMemo(() => {
    let acum = 0;
    return [...linhas].sort((a, b) => b.vr - a.vr).map((l) => ({ ...l, acum: (acum += l.vr) }));
  }, [linhas]);
  const colunas = colunasPorGrupo(base.onGrupo, linhas, tot);
  const colunasProdutos = [
    colCodigo,
    colDescricao,
    colGrupo(base.onGrupo),
    colUn,
    colReal,
    { rotulo: "Vlr Unit. (R$)", num: "dec", valor: (l) => l.vlrUnit, classe: () => "text-muted" },
    { rotulo: "Vlr Total (R$)", num: "dec", valor: (l) => l.vr, total: tot.vr, classe: () => "font-medium text-ink" },
    { rotulo: "% do total", num: "pct", valor: (l) => pct(l.vr, tot.vr), total: tot.vr > 0 ? 100 : null, classe: () => "text-muted" },
    { rotulo: "% acumulado", num: "pct", valor: (l) => pct(l.acum, tot.vr), classe: () => "text-muted" },
  ];
  return (
    <JanelaCard
      titulo="Valor em estoque"
      subtitulo={base.subtitulo}
      prefixo={base.prefixo}
      onFechar={base.onFechar}
      largura="6xl"
      exportar={{ nome: "Valor por grupo", colunas, linhas: grupos }}
    >
      <Nota>Vlr Total do Relatório de Estoque Físico na data, somando as empresas do filtro. Clique no grupo para deixar a página só com ele.</Nota>
      <TabelaJanela colunas={colunas} linhas={grupos} chave={(g) => g.grp} vazio="Nenhum produto no filtro." rotuloTotal={`Total · ${int(grupos.length)} grupo(s)`} />
      <Secao
        titulo={`Valor por produto, do maior para o menor · ${int(produtos.length)}`}
        acoes={exportarTabela(base.prefixo, { nome: "Valor por produto", colunas: colunasProdutos, linhas: produtos })}
      >
        <TabelaJanela colunas={colunasProdutos} linhas={produtos} chave={chaveProduto} vazio="Nenhum produto no filtro." />
      </Secao>
    </JanelaCard>
  );
}

/** Card Hectares: estoque real ÷ dose de cada produto com dosagem; abaixo, os que ficam fora da soma (sem dosagem). */
function JanelaHectares({ linhas, tot, base }) {
  const comDose = useMemo(() => linhas.filter((l) => l.ha !== null).sort((a, b) => b.ha - a.ha), [linhas]);
  const semDose = useMemo(() => linhas.filter((l) => l.ha === null), [linhas]);
  const colunas = [
    colCodigo,
    colDescricao,
    colGrupo(base.onGrupo),
    colUn,
    colReal,
    {
      rotulo: "Dosagem /ha",
      num: "qtd",
      valor: (l) => l.dose,
      exibir: (l) => (
        <>
          {nf(l.dose, 3)}
          {l.doseOrigem === "dosagens" && <span className="text-muted">*</span>}
        </>
      ),
      dica: (l) => (l.doseOrigem === "dosagens" ? "Do cadastro Insumos › Dosagens (sem dose na planilha)" : undefined),
    },
    { rotulo: "Origem da dose", valor: (l) => (l.doseOrigem === "dosagens" ? "Insumos › Dosagens" : "Planilha de estoque"), soPlanilha: true },
    { rotulo: "Hectares", num: "dec", valor: (l) => l.ha, total: tot.ha, classe: () => "font-medium text-ink" },
  ];
  const colunasSem = [colCodigo, colDescricao, colGrupo(base.onGrupo), colUn, colReal];
  return (
    <JanelaCard
      titulo="Hectares (estoque ÷ dose)"
      subtitulo={base.subtitulo}
      prefixo={base.prefixo}
      onFechar={base.onFechar}
      largura="6xl"
      exportar={{ nome: "Hectares por produto", colunas, linhas: comDose }}
    >
      <Nota>
        Hectares = estoque real ÷ dosagem por hectare, por produto. A dosagem é a da planilha de estoque; com *, do cadastro Insumos › Dosagens (produto sem
        dose na planilha). Produtos sem dosagem não entram na soma.
      </Nota>
      <TabelaJanela
        colunas={colunas}
        linhas={comDose}
        chave={chaveProduto}
        vazio="Nenhum produto com dosagem no filtro."
        rotuloTotal={`Total · ${int(comDose.length)} produto(s) com dosagem`}
      />
      <Secao
        titulo={`Produtos sem dosagem (fora da soma) · ${int(semDose.length)}`}
        acoes={exportarTabela(base.prefixo, { nome: "Produtos sem dosagem", colunas: colunasSem, linhas: semDose })}
      >
        <TabelaJanela colunas={colunasSem} linhas={semDose} chave={chaveProduto} vazio="Todos os produtos do filtro têm dosagem." />
      </Secao>
    </JanelaCard>
  );
}

/** Card Produtos: os produtos do relatório (na ordem da página) e quantos há em cada grupo. */
function JanelaProdutos({ linhas, tot, base }) {
  const grupos = useMemo(() => somarPorGrupo(linhas), [linhas]);
  const colunas = [
    colCodigo,
    colDescricao,
    colGrupo(base.onGrupo),
    { rotulo: "Princípio Ativo", valor: (l) => l.principioAtivo, exibir: (l) => l.principioAtivo || "–", classe: () => "max-w-[240px] text-[12px] text-muted" },
    colUn,
    colReal,
    colDisp,
    { rotulo: "Vlr Total (R$)", num: "dec", valor: (l) => l.vr, total: tot.vr },
  ];
  const colunasGrupo = colunasPorGrupo(base.onGrupo, linhas, tot);
  return (
    <JanelaCard
      titulo="Produtos"
      subtitulo={base.subtitulo}
      prefixo={base.prefixo}
      onFechar={base.onFechar}
      largura="6xl"
      exportar={{ nome: "Produtos", colunas, linhas }}
    >
      <Nota>Cada produto (código) do relatório na data, somando as empresas do filtro. Clique no grupo para deixar a página só com ele.</Nota>
      <TabelaJanela colunas={colunas} linhas={linhas} chave={chaveProduto} vazio="Nenhum produto no filtro." rotuloTotal={`Total · ${int(linhas.length)} produto(s)`} />
      <Secao
        titulo={`Por grupo · ${int(grupos.length)}`}
        acoes={exportarTabela(base.prefixo, { nome: "Produtos por grupo", colunas: colunasGrupo, linhas: grupos })}
      >
        <TabelaJanela
          colunas={colunasGrupo}
          linhas={grupos}
          chave={(g) => g.grp}
          vazio="Nenhum produto no filtro."
          rotuloTotal={`Total · ${int(grupos.length)} grupo(s)`}
        />
      </Secao>
    </JanelaCard>
  );
}

/** Card Real × disponível: os produtos com diferença entre o estoque disponível e o real, da maior diferença para a menor. */
function JanelaDiferenca({ linhas, tot, base }) {
  const comDif = useMemo(() => linhas.filter((l) => Math.abs(l.dif) >= 0.0005).sort((a, b) => Math.abs(b.dif) - Math.abs(a.dif)), [linhas]);
  const colunas = [
    colCodigo,
    colDescricao,
    colGrupo(base.onGrupo),
    colUn,
    colReal,
    colDisp,
    { rotulo: "Dif. Real × Disp.", num: "qtdVar", valor: (l) => l.dif, total: tot.dif, classe: (l) => `font-medium ${corVariacao(l.dif, 3)}` },
  ];
  return (
    <JanelaCard
      titulo="Real × disponível"
      subtitulo={base.subtitulo}
      prefixo={base.prefixo}
      onFechar={base.onFechar}
      largura="6xl"
      exportar={{ nome: "Real × disponível", colunas, linhas: comDif }}
    >
      <Nota>
        Dif. = estoque disponível − estoque real, por produto, somando as empresas do filtro: positiva, há mais disponível que real; negativa, menos. O
        total é a Diferença total do card (os demais produtos não têm diferença). Clique no grupo para deixar a página só com ele.
      </Nota>
      <TabelaJanela
        colunas={colunas}
        linhas={comDif}
        chave={chaveProduto}
        vazio="Nenhum produto com diferença entre o estoque real e o disponível."
        rotuloTotal={`Total · ${int(comDif.length)} produto(s) com diferença`}
      />
    </JanelaCard>
  );
}

function ImportarEstoque({ onFechar }) {
  const [arquivos, setArquivos] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState(null);
  const [resultados, setResultados] = useState(null);

  async function enviar() {
    setEnviando(true);
    setErro(null);
    try {
      const form = new FormData();
      arquivos.forEach((a) => form.append("arquivo", a));
      const res = await fetch("/api/insumos/estoque/importar", { method: "POST", body: form });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Não foi possível importar.");
      setResultados(j.resultados);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível importar.");
    } finally {
      setEnviando(false);
    }
  }

  const importou = !!resultados?.some((r) => r.ok);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 px-3">
      <div className="w-full max-w-lg rounded-xl2 bg-card p-5 shadow-pop">
        <h3 className="text-[15px] font-semibold text-ink">Importar estoque</h3>
        <p className="mb-3 mt-1 text-[12.5px] leading-relaxed text-muted">
          Envie o <b className="text-ink">Relatório de Estoque Físico</b> do sistema (um arquivo por empresa). Cada arquivo grava o retrato da empresa na data
          do relatório; importar de novo a mesma empresa e data substitui o retrato anterior.
        </p>
        {!resultados && (
          <input
            type="file"
            accept=".xlsx,.xls"
            multiple
            onChange={(e) => setArquivos(Array.from(e.target.files ?? []).slice(0, 10))}
            className="block w-full text-[12.5px]"
          />
        )}
        {resultados && (
          <ul className="space-y-1.5">
            {resultados.map((r) => (
              <li
                key={r.arquivo}
                className={`rounded-md border px-3 py-2 text-[12.5px] ${r.ok ? "border-good-500/30 bg-good-50 text-good-700" : "border-alert-500/30 bg-alert-50 text-alert-700"}`}
              >
                <b>{r.arquivo}</b>
                <br />
                {r.ok
                  ? `${nomeEmpresa(r.emp)} · ${fmtDateBR(r.dt)} · ${r.itens} produto(s)${r.substituiu ? ` (substituiu ${r.substituiu} da mesma data)` : ""}`
                  : r.erro}
              </li>
            ))}
          </ul>
        )}
        {erro && <p className="mt-3 rounded-md border border-alert-500/40 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-700">{erro}</p>}
        <div className="mt-4 flex justify-end gap-2">
          <button
            type="button"
            onClick={() => onFechar(importou)}
            className="rounded-lg border border-line px-4 py-1.5 text-[12.5px] text-ink hover:bg-surface"
          >
            {resultados ? "Fechar" : "Cancelar"}
          </button>
          {!resultados && (
            <button
              type="button"
              disabled={arquivos.length === 0 || enviando}
              onClick={enviar}
              className="rounded-lg bg-navy-900 px-4 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40"
            >
              {enviando ? "Importando…" : "Importar"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
