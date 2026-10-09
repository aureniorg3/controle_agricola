"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import BotaoLog from "@/components/BotaoLog";
import { IconImportar, IconImprimir } from "@/components/icons";
import { BarraFiltros, CabecalhoPagina, Comando, CorpoPagina, Indicador, Pagina, Painel } from "@/components/pagina";
import { fmtDateBR } from "@/lib/format";
import { addDays } from "@/lib/period";
import { DEPOSITOS_PADRAO, EMPRESAS, hectaresDoSaldo, montarMatriz, nomeEmpresa, precoMedio, textoDosagem, textoHectares } from "@/lib/insumos-saldo";
import { gerarRelatorioSaldoPdf } from "@/lib/relatorio-saldo-insumos-pdf";
import { podeEditar } from "@/lib/permissoes";

import { ehBooleano, ehTexto, usarPersistido } from "@/lib/usar-persistido";
import BotaoLimparFiltros from "@/components/BotaoLimparFiltros";

const INPUT = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px]";
const ROTULO = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted";
const BOTAO = "rounded-lg border border-line bg-card px-3.5 py-2 text-[13px] font-semibold text-navy-800 shadow-card hover:bg-surface disabled:opacity-50";
const COR_EMPRESA = { 5: "#23396B", 6: "#D77B38" };
const corEmpresa = (emp) => COR_EMPRESA[emp] ?? "#5C6777";

const nf = (n, c = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
const brl = (n) => `R$ ${nf(n)}`;
function brlCurto(n) {
  const a = Math.abs(n);
  const s = a >= 1e6 ? `${nf(a / 1e6, 2)} mi` : a >= 1e3 ? `${nf(a / 1e3, 1)} mil` : nf(a, 0);
  return `${n < 0 ? "-" : ""}R$ ${s}`;
}
const celula = (n, c = 2) => (Math.abs(n) < 0.0005 ? "" : nf(n, c));

export default function SaldoClient({ perfil, nomeUsuario }) {
  const podeImportar = podeEditar(perfil);
  const [empStr, setEmpStr] = usarPersistido("saldo.emp", EMPRESAS.map((e) => e.id).join(","), ehTexto);
  const [depStr, setDepStr] = usarPersistido("saldo.dep", DEPOSITOS_PADRAO.join(","), ehTexto);
  const [grupo, setGrupo] = usarPersistido("saldo.grupo", "", ehTexto);
  const [q, setQ] = usarPersistido("saldo.q", "", ehTexto);
  const [separar, setSeparar] = usarPersistido("saldo.separar", false, ehBooleano);
  const [dtBase, setDtBase] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [importar, setImportar] = useState(false);
  const [gerando, setGerando] = useState(false);
  const [qDebounce, setQDebounce] = useState(q);

  const empresas = useMemo(
    () =>
      empStr
        .split(",")
        .map(Number)
        .filter((n) => Number.isInteger(n)),
    [empStr],
  );
  const depositos = useMemo(
    () =>
      depStr
        .split(",")
        .map(Number)
        .filter((n) => Number.isInteger(n)),
    [depStr],
  );

  useEffect(() => {
    const t = setTimeout(() => setQDebounce(q), 350);
    return () => clearTimeout(t);
  }, [q]);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const p = new URLSearchParams({ emp: empresas.join(","), almx: depositos.join(","), q: qDebounce, grupo });
      if (dtBase) p.set("dt", dtBase);
      if (de) p.set("de", de);
      if (ate) p.set("ate", ate);
      const res = await fetch(`/api/insumos/saldo?${p}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Não foi possível carregar o saldo.");
      setDados(json);
      if (!dtBase && json.dtBase) setDtBase(json.dtBase);
      if (!ate && json.dtBase) setAte(json.dtBase);
      if (!de && json.dtBase) setDe(addDays(json.dtBase, -30));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar o saldo.");
    } finally {
      setCarregando(false);
    }
  }, [empresas, depositos, qDebounce, grupo, dtBase, de, ate]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const matriz = useMemo(() => montarMatriz(dados?.linhas ?? [], separar), [dados, separar]);

  // depósitos distintos (um código pode existir nas duas empresas)
  const opcoesDeposito = useMemo(() => {
    const m = new Map();
    for (const d of dados?.depositos ?? []) m.set(d.almx, [...(m.get(d.almx) ?? []), d.nm]);
    return Array.from(m.entries()).map(([almx, nms]) => ({ almx, nm: Array.from(new Set(nms.filter(Boolean)))[0] ?? "" }));
  }, [dados]);

  const alternar = (lista, v) => (lista.includes(v) ? lista.filter((x) => x !== v) : [...lista, v]);

  // série diária por data (total e por empresa/depósito) com a variação sobre o retrato anterior
  const movimento = useMemo(() => {
    const serie = dados?.serie ?? [];
    const datas = Array.from(new Set(serie.map((s) => s.dt))).sort();
    const chaveDe = (s) => (separar ? `${s.emp}|${s.almx}` : `${s.emp}`);
    const linhas = new Map();
    for (const s of serie) {
      const k = chaveDe(s);
      const l = linhas.get(k) ?? { emp: s.emp, almx: separar ? s.almx : null, valores: {} };
      l.valores[s.dt] = (l.valores[s.dt] ?? 0) + s.valor;
      linhas.set(k, l);
    }
    const lista = Array.from(linhas.values()).sort((a, b) => a.emp - b.emp || (a.almx ?? 0) - (b.almx ?? 0));
    const totalPorData = {};
    for (const s of serie) totalPorData[s.dt] = (totalPorData[s.dt] ?? 0) + s.valor;
    const visiveis = datas.filter((d) => !de || d >= de);
    const delta = (valores, d) => {
      const i = datas.indexOf(d);
      return i > 0 ? (valores[d] ?? 0) - (valores[datas[i - 1]] ?? 0) : null;
    };
    return { datas: visiveis, lista, totalPorData, delta };
  }, [dados, separar, de]);

  const kpis = useMemo(() => {
    const itens = new Set((dados?.linhas ?? []).map((l) => l.cod)).size;
    const porEmp = EMPRESAS.map((e) => ({ ...e, valor: (dados?.linhas ?? []).filter((l) => l.emp === e.id).reduce((a, l) => a + l.valor, 0) })).filter((e) =>
      empresas.includes(e.id),
    );
    const t = movimento.totalPorData;
    const datas = Object.keys(t).sort();
    const i = dtBase ? datas.indexOf(dtBase) : -1;
    const var1 = i > 0 ? t[datas[i]] - t[datas[i - 1]] : null;
    return { itens, porEmp, var1, anterior: i > 0 ? datas[i - 1] : null };
  }, [dados, movimento, dtBase, empresas]);

  const topItens = useMemo(() => {
    const m = new Map();
    for (const g of matriz.grupos) for (const it of g.itens) m.set(it.cod, { ds: it.ds, valor: it.total.valor });
    return Array.from(m.entries())
      .map(([cod, v]) => ({ cod, ...v }))
      .sort((a, b) => b.valor - a.valor)
      .slice(0, 6);
  }, [matriz]);

  const indiceData = dados && dtBase ? dados.datas.indexOf(dtBase) : -1;
  // período padrão: retrato mais recente e os 30 dias antes dele (preenchido ao carregar quando a data está vazia)
  const ultimaDataBase = dados?.datas.length ? dados.datas[dados.datas.length - 1] : "";
  const periodoAlterado = !!ultimaDataBase && !!dtBase && (dtBase !== ultimaDataBase || de !== addDays(ultimaDataBase, -30) || ate !== ultimaDataBase);
  const algumFiltroAtivo =
    empStr !== EMPRESAS.map((e) => e.id).join(",") || depStr !== DEPOSITOS_PADRAO.join(",") || grupo !== "" || q !== "" || separar !== false || periodoAlterado;
  function limparFiltros() {
    setEmpStr(EMPRESAS.map((e) => e.id).join(","));
    setDepStr(DEPOSITOS_PADRAO.join(","));
    setGrupo("");
    setQ("");
    setQDebounce("");
    setSeparar(false);
    if (periodoAlterado) {
      setDtBase("");
      setDe("");
      setAte("");
    }
  }

  const irData = (delta) => {
    if (!dados || indiceData < 0) return;
    const nova = dados.datas[indiceData + delta];
    if (nova) {
      setDtBase(nova);
      setAte(nova);
      setDe(addDays(nova, -30));
    }
  };

  async function imprimir() {
    if (!dados || !dtBase) return;
    setGerando(true);
    try {
      await gerarRelatorioSaldoPdf({
        dtBase,
        matriz,
        separar,
        topItens,
        nomeUsuario,
        dosagens: dados.dosagens ?? {},
        principios: dados.principios ?? {},
        movimento: { datas: movimento.datas.slice(-10), lista: movimento.lista, delta: movimento.delta, totalPorData: movimento.totalPorData },
      });
    } finally {
      setGerando(false);
    }
  }

  const cols = matriz.colunas;
  // 4 colunas de identificação + 3 por empresa + 3 do total + dosagem e hectares
  const nColsTotal = 5 + cols.length * 3 + 3 + 2;
  const th = "px-2 py-1.5 text-right text-[10.5px] font-semibold uppercase tracking-wide";
  const td = "px-2 py-1 text-right tabular";
  const maxGrupo = Math.max(1, ...matriz.grupos.map((g) => g.total.valor));
  const maxTop = Math.max(1, ...topItens.map((t) => t.valor));

  return (
    <Pagina translate="no">
      <CabecalhoPagina
        titulo="Saldo Insumos"
        categoria="Acompanhamentos · Insumos"
        comandos={
          <>
            {podeImportar && (
              <Comando primario icone={<IconImportar size={16} />} onClick={() => setImportar(true)}>
                Importar saldo do dia
              </Comando>
            )}
            <Comando icone={<IconImprimir size={16} />} onClick={imprimir} disabled={gerando || !dados || matriz.grupos.length === 0}>
              {gerando ? "Gerando…" : "Imprimir / PDF"}
            </Comando>
            <BotaoLog titulo="Log do Saldo de Insumos" filtro={{ modulo: "Insumos", entidade: "Saldo de insumos" }} />
          </>
        }
      />

      <CorpoPagina>
        {/* Filtros */}
        <BarraFiltros>
          <div className="min-w-[240px] flex-[2]">
            <label className={ROTULO}>Data base</label>
            <div className="flex gap-1.5">
              <button type="button" onClick={() => irData(-1)} disabled={indiceData <= 0} className={`${BOTAO} px-2.5`} aria-label="Retrato anterior">
                ◀
              </button>
              <select
                value={dtBase}
                onChange={(e) => {
                  setDtBase(e.target.value);
                  setAte(e.target.value);
                  setDe(addDays(e.target.value, -30));
                }}
                className={INPUT}
              >
                {[...(dados?.datas ?? [])].reverse().map((d) => (
                  <option key={d} value={d}>
                    {fmtDateBR(d)}
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => irData(1)}
                disabled={!dados || indiceData >= dados.datas.length - 1}
                className={`${BOTAO} px-2.5`}
                aria-label="Próximo retrato"
              >
                ▶
              </button>
            </div>
          </div>
          <div className="min-w-[140px] flex-1">
            <label className={ROTULO}>Período — de</label>
            <input type="date" value={de} onChange={(e) => setDe(e.target.value)} className={INPUT} />
          </div>
          <div className="min-w-[140px] flex-1">
            <label className={ROTULO}>Período — até</label>
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className={INPUT} />
          </div>
          <div className="min-w-[180px] flex-1">
            <label className={ROTULO}>Grupo</label>
            <select value={grupo} onChange={(e) => setGrupo(e.target.value)} className={INPUT}>
              <option value="">Todos</option>
              {(dados?.grupos ?? []).map((g) => (
                <option key={g.cod} value={g.cod}>
                  {g.cod.trim()} · {g.ds.trim()}
                </option>
              ))}
            </select>
          </div>
          <div className="min-w-[160px] flex-1">
            <label className={ROTULO}>Insumo</label>
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Código ou nome" className={INPUT} />
          </div>
          {/* segunda linha: empresas, depósitos e opções */}
          <div className="flex w-full flex-wrap items-center gap-x-6 gap-y-2">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Empresa</span>
              {EMPRESAS.map((e) => (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setEmpStr(alternar(empresas, e.id).join(","))}
                  className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${empresas.includes(e.id) ? "border-navy-900 bg-navy-900 text-white" : "border-line bg-surface text-muted"}`}
                >
                  {e.nome}
                </button>
              ))}
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[11px] font-semibold uppercase tracking-wide text-muted">Depósito</span>
              {opcoesDeposito.map((d) => (
                <button
                  key={d.almx}
                  type="button"
                  title={d.nm}
                  onClick={() => setDepStr(alternar(depositos, d.almx).join(","))}
                  className={`rounded-full border px-3 py-1 text-[12px] font-semibold ${depositos.includes(d.almx) ? "border-navy-900 bg-navy-900 text-white" : "border-line bg-surface text-muted"}`}
                >
                  {d.almx}
                </button>
              ))}
              <button type="button" className="text-[11.5px] text-navy-800 underline" onClick={() => setDepStr(DEPOSITOS_PADRAO.join(","))}>
                insumos agrícolas (207, 401)
              </button>
            </div>
            <label className="flex items-center gap-1.5 text-[12.5px] text-ink">
              <input type="checkbox" checked={separar} onChange={(e) => setSeparar(e.target.checked)} />
              Separar por depósito
            </label>
            <BotaoLimparFiltros ativo={algumFiltroAtivo} onLimpar={limparFiltros} />
          </div>
        </BarraFiltros>

        {erro && <p className="mb-3 rounded-md border border-alert-500/40 bg-alert-50 px-3 py-2 text-[13px] text-alert-700">{erro}</p>}

        {/* Indicadores */}
        <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Indicador cor="azul" rotulo="Valor em estoque" valor={brl(matriz.total.valor)} apoio={`Data base ${dtBase ? fmtDateBR(dtBase) : "—"}`} />
          <Indicador
            cor={kpis.var1 === null ? "cinza" : kpis.var1 >= 0 ? "verde" : "vermelho"}
            rotulo="Variação sobre o retrato anterior"
            valor={kpis.var1 === null ? "—" : `${kpis.var1 >= 0 ? "▲" : "▼"} ${brl(Math.abs(kpis.var1))}`}
            apoio={kpis.anterior ? `vs ${fmtDateBR(kpis.anterior)}` : "sem retrato anterior no período"}
          />
          <Indicador cor="cinza" rotulo="Insumos com saldo" valor={kpis.itens} apoio={`${matriz.grupos.length} grupo(s)`} />
          {/* lista por empresa: mesmo cartão do Indicador, com uma linha por empresa no lugar do número */}
          <div className="min-w-0 rounded-xl2 border border-line bg-card py-3 pl-4 pr-3.5 shadow-card">
            <div className="mb-1 truncate text-[12px] text-muted">Por empresa</div>
            {kpis.porEmp.map((e) => (
              <div key={e.id} className="flex items-center justify-between text-[13px]">
                <span className="flex items-center gap-1.5 font-semibold" style={{ color: corEmpresa(e.id) }}>
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: corEmpresa(e.id) }} />
                  {e.nome}
                </span>
                <span className="tabular text-ink">{brl(e.valor)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Gráficos */}
        <div className="mb-4 grid gap-3 lg:grid-cols-3">
          <Painel titulo="Valor por grupo">
            <div className="space-y-2">
              {matriz.grupos.map((g) => (
                <div key={g.grp}>
                  <div className="flex justify-between text-[11.5px]">
                    <span className="truncate pr-2 text-ink">{g.grpDs.trim()}</span>
                    <span className="tabular font-semibold">{brlCurto(g.total.valor)}</span>
                  </div>
                  <div className="flex h-3 overflow-hidden rounded bg-surface" style={{ width: `${Math.max(2, (g.total.valor / maxGrupo) * 100)}%` }}>
                    {EMPRESAS.map((e) => {
                      const v = Object.entries(g.cels)
                        .filter(([k]) => k.split("|")[0] === String(e.id))
                        .reduce((a, [, c]) => a + c.valor, 0);
                      return v > 0 ? (
                        <div key={e.id} title={`${e.nome}: ${brl(v)}`} style={{ width: `${(v / g.total.valor) * 100}%`, background: corEmpresa(e.id) }} />
                      ) : null;
                    })}
                  </div>
                </div>
              ))}
              {matriz.grupos.length === 0 && <p className="text-[12px] text-muted">Sem dados para os filtros.</p>}
            </div>
            <div className="mt-3 flex gap-3 text-[11px] text-muted">
              {EMPRESAS.filter((e) => empresas.includes(e.id)).map((e) => (
                <span key={e.id} className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: corEmpresa(e.id) }} />
                  {e.nome}
                </span>
              ))}
            </div>
          </Painel>

          <Painel titulo="Top 6 insumos (R$)">
            <div className="space-y-2">
              {topItens.map((t) => (
                <div key={t.cod}>
                  <div className="flex justify-between text-[11.5px]">
                    <span className="truncate pr-2 text-ink">{t.ds}</span>
                    <span className="tabular font-semibold">{brlCurto(t.valor)}</span>
                  </div>
                  <div className="h-3 rounded bg-navy-900" style={{ width: `${Math.max(2, (t.valor / maxTop) * 100)}%` }} />
                </div>
              ))}
              {topItens.length === 0 && <p className="text-[12px] text-muted">Sem dados para os filtros.</p>}
            </div>
          </Painel>

          <Painel titulo="Evolução do valor no período">
            <Evolucao totalPorData={movimento.totalPorData} datas={movimento.datas} />
          </Painel>
        </div>

        {/* Matriz */}
        <div className="mb-4 overflow-x-auto rounded-xl2 border border-line bg-card shadow-card">
          <table className="w-full min-w-[900px] text-[12px]">
            <thead>
              <tr className="bg-navy-900 text-white">
                <th colSpan={5} className="px-2 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-wide">
                  Data base: {dtBase ? fmtDateBR(dtBase) : "—"}
                </th>
                {cols.map((c) => (
                  <th
                    key={c.chave}
                    colSpan={3}
                    className="border-l border-white/20 px-2 py-1.5 text-center text-[10.5px] font-semibold uppercase tracking-wide"
                  >
                    {c.rotulo}
                    {c.sub && <span className="ml-1 opacity-80">· {c.sub}</span>}
                  </th>
                ))}
                <th
                  colSpan={3}
                  className="border-l border-white/20 bg-orange-600 px-2 py-1.5 text-center text-[10.5px] font-semibold uppercase tracking-wide"
                  style={{ background: "#D77B38" }}
                >
                  Total
                </th>
                <th
                  colSpan={2}
                  className="border-l border-white/20 px-2 py-1.5 text-center text-[10.5px] font-semibold uppercase tracking-wide"
                  style={{ background: "#2D8A5A" }}
                >
                  Aplicação
                </th>
              </tr>
              <tr className="bg-surface text-muted">
                <th className="px-2 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-wide">Grupo</th>
                <th className="px-2 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-wide">Código</th>
                <th className="px-2 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-wide">Descrição do insumo</th>
                <th className="px-2 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-wide" title="Do cadastro Material e Insumos (aba Insumos)">
                  Princípio ativo
                </th>
                <th className="px-2 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-wide">UM</th>
                {[...cols, null].map((c) => (
                  <Fragment key={c?.chave ?? "total"}>
                    <th className={`${th} border-l border-line`}>Qtd</th>
                    <th className={th}>Preço médio</th>
                    <th className={th}>Vl. total</th>
                  </Fragment>
                ))}
                <th
                  className={`${th} whitespace-nowrap border-l border-line`}
                  title="Dosagem por hectare do cadastro (Insumos › Dosagens), na unidade do insumo"
                >
                  Dosagem /ha
                </th>
                <th
                  className={`${th} whitespace-nowrap`}
                  title="Quantidade total do saldo ÷ dosagem por hectare. Com a dosagem máxima é o mínimo de hectares; com a mínima também, mostra a faixa."
                >
                  Hectares
                </th>
              </tr>
            </thead>
            <tbody>
              {carregando && matriz.grupos.length === 0 && (
                <tr>
                  <td colSpan={nColsTotal} className="px-3 py-6 text-center text-muted">
                    Carregando…
                  </td>
                </tr>
              )}
              {!carregando && matriz.grupos.length === 0 && (
                <tr>
                  <td colSpan={nColsTotal} className="px-3 py-6 text-center text-muted">
                    Nenhum insumo com saldo para os filtros escolhidos.
                  </td>
                </tr>
              )}
              {matriz.grupos.map((g) => (
                <Fragment key={g.grp}>
                  {g.itens.map((it, i) => (
                    <tr key={it.cod} className="border-t border-line/60 hover:bg-surface/60">
                      <td className="px-2 py-1 font-semibold text-navy-900">{i === 0 ? g.grp.trim() : ""}</td>
                      <td className="px-2 py-1 tabular text-muted">{it.cod}</td>
                      <td className="px-2 py-1 text-ink">{it.ds}</td>
                      <td className="max-w-[240px] px-2 py-1 text-[11.5px] text-muted">{dados?.principios?.[it.cod] || "–"}</td>
                      <td className="px-2 py-1 text-muted">{it.un}</td>
                      {cols.map((c) => {
                        const x = it.cels[c.chave];
                        return (
                          <Fragment key={c.chave}>
                            <td className={`${td} border-l border-line/60`}>{x ? celula(x.qtd) : ""}</td>
                            <td className={td}>{x ? celula(precoMedio(x)) : ""}</td>
                            <td className={td}>{x ? celula(x.valor) : ""}</td>
                          </Fragment>
                        );
                      })}
                      <td className={`${td} border-l border-line/60 font-semibold`}>{celula(it.total.qtd)}</td>
                      <td className={`${td} font-semibold`}>{celula(precoMedio(it.total))}</td>
                      <td className={`${td} font-semibold`}>{celula(it.total.valor)}</td>
                      {(() => {
                        const dos = dados?.dosagens?.[it.cod];
                        const dosagem = textoDosagem(dos);
                        const hectares = textoHectares(hectaresDoSaldo(it.total.qtd, dos));
                        return (
                          <>
                            <td className={`${td} whitespace-nowrap border-l border-line/60 ${dosagem ? "" : "text-muted/50"}`}>{dosagem || "—"}</td>
                            <td className={`${td} whitespace-nowrap font-semibold ${hectares ? "" : "font-normal text-muted/50"}`}>{hectares || "—"}</td>
                          </>
                        );
                      })()}
                    </tr>
                  ))}
                  <tr className="linha-subtotal border-t border-line font-bold">
                    <td className="px-2 py-1" colSpan={5}>
                      {g.grp.trim()} · {g.grpDs.trim()} — total
                    </td>
                    {cols.map((c) => {
                      const x = g.cels[c.chave];
                      return (
                        <Fragment key={c.chave}>
                          <td className={`${td} border-l border-line/60`}>{x ? celula(x.qtd) : ""}</td>
                          <td className={td}>{x ? celula(precoMedio(x)) : ""}</td>
                          <td className={td}>{x ? celula(x.valor) : ""}</td>
                        </Fragment>
                      );
                    })}
                    <td className={`${td} border-l border-line/60`}>{celula(g.total.qtd)}</td>
                    <td className={td}>{celula(precoMedio(g.total))}</td>
                    <td className={td}>{celula(g.total.valor)}</td>
                    <td colSpan={2} className="border-l border-line/60" />
                  </tr>
                </Fragment>
              ))}
              {matriz.grupos.length > 0 && (
                <tr className="border-t-2 border-navy-900 bg-navy-900 font-bold text-white">
                  <td className="px-2 py-1.5" colSpan={5}>
                    Total geral
                  </td>
                  {cols.map((c) => {
                    const x = matriz.cels[c.chave];
                    return (
                      <Fragment key={c.chave}>
                        <td className={`${td} border-l border-white/20`}>{x ? celula(x.qtd) : ""}</td>
                        <td className={td}>{x ? celula(precoMedio(x)) : ""}</td>
                        <td className={td}>{x ? celula(x.valor) : ""}</td>
                      </Fragment>
                    );
                  })}
                  <td className={`${td} border-l border-white/20`}>{celula(matriz.total.qtd)}</td>
                  <td className={td}>{celula(precoMedio(matriz.total))}</td>
                  <td className={td}>{celula(matriz.total.valor)}</td>
                  <td colSpan={2} className="border-l border-white/20" />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="mb-4 text-[11.5px] text-muted">
          Valor = saldo × custo médio de cada depósito; preço médio = valor ÷ quantidade. Quantidades na unidade de consumo do insumo. Hectares = quantidade
          total ÷ dosagem por hectare (Insumos › Dosagens): com a dosagem máxima é o mínimo de hectares e, havendo mínima também, aparece a faixa.
        </p>

        {/* Movimentação diária */}
        <div className="overflow-x-auto rounded-xl2 border border-line bg-card shadow-card">
          <div className="px-3 py-2 text-[12px] font-bold uppercase tracking-wide text-white" style={{ background: "#2D8A5A" }}>
            Movimentação diária (R$) — variação do valor em estoque sobre o retrato anterior
          </div>
          <table className="w-full text-[12px]">
            <thead>
              <tr className="bg-surface text-muted">
                <th className="px-3 py-1.5 text-left text-[10.5px] font-semibold uppercase tracking-wide">Empresa{separar ? " · depósito" : ""}</th>
                {movimento.datas.map((d) => (
                  <th key={d} className="px-2 py-1.5 text-right text-[10.5px] font-semibold uppercase tracking-wide">
                    {fmtDateBR(d).slice(0, 5)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {movimento.lista.map((l) => (
                <tr key={`${l.emp}|${l.almx}`} className="border-t border-line/60">
                  <td className="px-3 py-1 font-semibold" style={{ color: corEmpresa(l.emp) }}>
                    {nomeEmpresa(l.emp)}
                    {l.almx !== null && <span className="ml-1 text-muted">· {l.almx}</span>}
                  </td>
                  {movimento.datas.map((d) => (
                    <Delta key={d} v={movimento.delta(l.valores, d)} />
                  ))}
                </tr>
              ))}
              {movimento.datas.length > 0 && (
                <tr className="border-t-2 border-line bg-surface font-bold">
                  <td className="px-3 py-1.5">Total</td>
                  {movimento.datas.map((d) => (
                    <Delta key={d} v={movimento.delta(movimento.totalPorData, d)} />
                  ))}
                </tr>
              )}
              {movimento.datas.length === 0 && (
                <tr>
                  <td className="px-3 py-4 text-center text-muted" colSpan={2}>
                    Sem retratos no período.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </CorpoPagina>

      {importar && (
        <ImportarSaldo
          onFechar={() => setImportar(false)}
          onConcluido={() => {
            setDtBase("");
            setDe("");
            setAte("");
            carregar();
          }}
        />
      )}
    </Pagina>
  );
}

function Delta({ v }) {
  if (v === null) return <td className="px-2 py-1 text-right tabular text-muted/60">—</td>;
  if (Math.abs(v) < 0.005) return <td className="px-2 py-1 text-right tabular text-muted/60">0,00</td>;
  return <td className={`px-2 py-1 text-right tabular ${v > 0 ? "text-good-600" : "text-alert-600"}`}>{nf(v)}</td>;
}

/** Linha do valor total por dia (e por empresa na legenda ao passar o mouse), em SVG simples. */
function Evolucao({ totalPorData, datas }) {
  const pts = datas.map((d) => ({ d, v: totalPorData[d] ?? 0 }));
  if (pts.length < 2) return <p className="text-[12px] text-muted">São necessários ao menos dois retrativos no período.</p>;
  const W = 320;
  const H = 150;
  const pad = { l: 8, r: 8, t: 14, b: 22 };
  const min = Math.min(...pts.map((p) => p.v));
  const max = Math.max(...pts.map((p) => p.v));
  const span = max - min || 1;
  const x = (i) => pad.l + (i / (pts.length - 1)) * (W - pad.l - pad.r);
  const y = (v) => pad.t + (1 - (v - min) / span) * (H - pad.t - pad.b);
  const linha = pts.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.v).toFixed(1)}`).join(" ");
  const ult = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Evolução do valor em estoque">
      <path d={`${linha} L${x(pts.length - 1)},${H - pad.b} L${x(0)},${H - pad.b} Z`} fill="#23396B" opacity="0.08" />
      <path d={linha} fill="none" stroke="#23396B" strokeWidth="2" />
      {pts.map((p, i) => (
        <circle key={p.d} cx={x(i)} cy={y(p.v)} r="2" fill="#23396B">
          <title>{`${fmtDateBR(p.d)}: ${brl(p.v)}`}</title>
        </circle>
      ))}
      <text x={pad.l} y={H - 6} fontSize="9" fill="#5C6777">
        {fmtDateBR(pts[0].d).slice(0, 5)}
      </text>
      <text x={W - pad.r} y={H - 6} fontSize="9" fill="#5C6777" textAnchor="end">
        {fmtDateBR(ult.d).slice(0, 5)}
      </text>
      <text x={pad.l} y={10} fontSize="9" fill="#5C6777">
        {brlCurto(max)}
      </text>
      <text x={W - pad.r} y={10} fontSize="9" fill="#23396B" textAnchor="end" fontWeight="bold">
        {brlCurto(ult.v)}
      </text>
    </svg>
  );
}

function ImportarSaldo({ onFechar, onConcluido }) {
  const [arquivos, setArquivos] = useState([]);
  const [previas, setPrevias] = useState(null);
  const [escolhas, setEscolhas] = useState([]);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState(null);
  const [feito, setFeito] = useState(null);

  async function enviar(confirmar) {
    setOcupado(true);
    setErro(null);
    try {
      const f = new FormData();
      arquivos.forEach((a) => f.append("arquivos", a));
      if (confirmar) {
        f.append("confirmar", "1");
        escolhas.forEach((e, i) => {
          f.append(`empresa_${i}`, String(e.empresa));
          f.append(`data_${i}`, e.data);
        });
      }
      const res = await fetch("/api/insumos/saldo/importar", { method: "POST", body: f });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Não foi possível importar.");
      if (confirmar) {
        setFeito(
          json.resultados.map(
            (r) =>
              `${nomeEmpresa(r.empresa)} · ${fmtDateBR(r.data)}: ${r.linhas} linhas, ${brl(r.valor)}${r.substituiu ? " (substituiu o retrato do dia)" : ""}`,
          ),
        );
        onConcluido();
      } else {
        setPrevias(json.previas);
        setEscolhas(json.previas.map((p) => ({ empresa: p.empresaSugerida, data: p.dataSugerida })));
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível importar.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-6 w-full max-w-3xl rounded-xl2 bg-card p-5 shadow-card">
        <h2 className="text-[16px] font-bold text-ink">Importar saldo de insumos do dia</h2>
        <p className="mt-1 text-[12.5px] text-muted">
          Envie o relatório de saldo do outro sistema — um arquivo por empresa (CRV-MG e PFCMO-MG). O retrato da mesma empresa e data é substituído; os demais
          dias do histórico não são alterados.
        </p>

        {!feito && (
          <div className="mt-3">
            <input
              type="file"
              multiple
              accept=".xlsx,.xls"
              onChange={(e) => {
                setArquivos(Array.from(e.target.files ?? []));
                setPrevias(null);
              }}
              className="block w-full text-[13px]"
            />
          </div>
        )}

        {previas && !feito && (
          <div className="mt-4 space-y-3">
            {previas.map((p, i) => (
              <div key={p.arquivo + i} className="rounded-lg border border-line p-3">
                <div className="flex flex-wrap items-center justify-between gap-2 text-[12.5px]">
                  <span className="font-semibold text-ink">{p.arquivo}</span>
                  <span className="text-muted">
                    {p.linhas} linhas · {brl(p.valor)}
                  </span>
                </div>
                {p.erro ? (
                  <p className="mt-1 text-[12.5px] text-alert-700">{p.erro}</p>
                ) : (
                  <>
                    <div className="mt-2 grid grid-cols-2 gap-3">
                      <div>
                        <label className={ROTULO}>Empresa</label>
                        <select
                          value={escolhas[i]?.empresa}
                          onChange={(e) => setEscolhas(escolhas.map((x, k) => (k === i ? { ...x, empresa: Number(e.target.value) } : x)))}
                          className={INPUT}
                        >
                          {EMPRESAS.map((e) => (
                            <option key={e.id} value={e.id}>
                              {e.nome}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className={ROTULO}>Data base</label>
                        <input
                          type="date"
                          value={escolhas[i]?.data}
                          onChange={(e) => setEscolhas(escolhas.map((x, k) => (k === i ? { ...x, data: e.target.value } : x)))}
                          className={INPUT}
                        />
                      </div>
                    </div>
                    <p className="mt-1.5 text-[11.5px] text-muted">
                      Depósitos no arquivo: {p.depositos.map((d) => `${d.almx} (${d.nm || "sem nome"}, ${d.linhas})`).join(" · ")}
                    </p>
                    {escolhas[i]?.empresa !== p.empresaSugerida && (
                      <p className="mt-1 text-[12px] text-amber-700">
                        Pelos depósitos, este arquivo parece ser de {nomeEmpresa(p.empresaSugerida)}. Confira a empresa.
                      </p>
                    )}
                    {p.jaExiste && escolhas[i]?.empresa === p.empresaSugerida && escolhas[i]?.data === p.dataSugerida && (
                      <p className="mt-1 text-[12px] text-amber-700">
                        Já existe o retrato de {nomeEmpresa(p.empresaSugerida)} em {fmtDateBR(p.dataSugerida)}: será substituído.
                      </p>
                    )}
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {feito && (
          <ul className="mt-4 space-y-1 rounded-lg border border-good-500/40 bg-good-50 p-3 text-[12.5px] text-good-700">
            {feito.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        )}

        {erro && <p className="mt-3 rounded-md border border-alert-500/40 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-700">{erro}</p>}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" className={BOTAO} onClick={onFechar}>
            {feito ? "Fechar" : "Cancelar"}
          </button>
          {!feito && !previas && (
            <button
              type="button"
              disabled={ocupado || arquivos.length === 0}
              onClick={() => enviar(false)}
              className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
            >
              {ocupado ? "Lendo…" : "Conferir arquivos"}
            </button>
          )}
          {!feito && previas && (
            <button
              type="button"
              disabled={ocupado || previas.some((p) => p.erro)}
              onClick={() => enviar(true)}
              className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
            >
              {ocupado ? "Importando…" : "Importar"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
