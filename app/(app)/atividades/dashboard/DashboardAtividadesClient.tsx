"use client";

import { Fragment, useEffect, useMemo, useState, type ReactNode } from "react";
import BotaoLimparFiltros from "@/components/BotaoLimparFiltros";
import BotaoLog from "@/components/BotaoLog";
import { IconAjustes, IconImprimir, IconSetaDireita, IconSetaEsquerda } from "@/components/icons";
import { GRUPO_OUTRAS, type DashboardAtividades, type OperacaoGrupo, type ValoresPeriodo } from "@/lib/dashboard-atividades";
import { fmtDateBR } from "@/lib/format";
import { addDays } from "@/lib/period";
import { podeEditar } from "@/lib/permissoes";
import type { PerfilUsuario } from "@/lib/types";

const FILTRO = "rounded-md border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink focus:border-brand-600 focus:outline-none";
const nf = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cel = (n: number | null) => (n === null ? "" : Math.abs(n) < 0.005 ? "–" : nf(n));
const DIAS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const dm = (iso: string) => fmtDateBR(iso).slice(0, 5);
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Atividades › Dashboard: entrada de cana por frente e área das operações lançadas, dia a dia na semana e acumulados. */
export default function DashboardAtividadesClient({ perfil, nomeUsuario }: { perfil: PerfilUsuario; nomeUsuario: string }) {
  const [dt, setDt] = useState("");
  const [dados, setDados] = useState<DashboardAtividades | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [gruposAberto, setGruposAberto] = useState(false);
  const [versao, setVersao] = useState(0);
  const [gerandoPdf, setGerandoPdf] = useState(false);

  async function gerarPdf() {
    if (!dados) return;
    setGerandoPdf(true);
    try {
      const { gerarRelatorioDashboardAtividadesPdf } = await import("@/lib/relatorio-dashboard-atividades-pdf");
      await gerarRelatorioDashboardAtividadesPdf(dados, nomeUsuario);
    } finally {
      setGerandoPdf(false);
    }
  }

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    fetch(`/api/atividades/dashboard${dt ? `?dt=${dt}` : ""}`, { cache: "no-store" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ativo) return;
        if (!ok) return setErro(j.error ?? "Não foi possível carregar o dashboard.");
        setErro(null);
        setDados(j);
      })
      .catch(() => ativo && setErro("Não foi possível carregar o dashboard."))
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [dt, versao]);

  const ref = dados?.dt ?? dt;
  // só dias fechados: a data vai no máximo até ontem
  const maxima = dados?.ultimoLancamento ?? "";
  const mudarDia = (delta: number) => ref && (delta < 0 || ref < maxima) && setDt(addDays(ref, delta));
  const mesRotulo = ref ? `${MESES[Number(ref.slice(5, 7)) - 1]}/${ref.slice(2, 4)}` : "";

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-shrink-0 flex-wrap items-center gap-3 border-b border-line bg-card px-6 py-3">
        <nav className="min-w-0 flex-1 text-[13px] text-muted">
          <span className="text-[11px] uppercase tracking-wide">Atividades</span>
          <div className="truncate text-[15px] font-bold text-ink">Dashboard</div>
        </nav>
        <button
          type="button"
          onClick={gerarPdf}
          disabled={!dados || carregando || gerandoPdf}
          className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 py-1.5 text-[13px] font-medium text-navy-800 shadow-card hover:bg-surface disabled:opacity-50"
        >
          <IconImprimir size={14} />
          {gerandoPdf ? "Gerando…" : "Gerar PDF"}
        </button>
        <BotaoLog titulo="Log dos Grupos de Operações" filtro={{ modulo: "Cadastros", entidade: "Cadastro de Grupos de Operações" }} />
        {podeEditar(perfil) && (
          <button
            type="button"
            onClick={() => setGruposAberto(true)}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 py-1.5 text-[13px] font-medium text-navy-800 shadow-card hover:bg-surface"
          >
            <IconAjustes size={14} />
            Grupos das operações
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mb-4 flex flex-wrap items-end gap-2.5 rounded-xl2 border border-line bg-card px-4 py-3 shadow-card">
          <label className="flex flex-col gap-1 text-[11.5px] text-muted">
            Data de referência
            <div className="flex items-center gap-1">
              <button type="button" onClick={() => mudarDia(-1)} className="rounded-md border border-line p-1.5 text-navy-800 hover:bg-surface" title="Dia anterior">
                <IconSetaEsquerda size={13} />
              </button>
              <input type="date" value={ref} max={maxima || undefined} onChange={(e) => e.target.value && setDt(e.target.value)} className={FILTRO} />
              <button
                type="button"
                onClick={() => mudarDia(1)}
                disabled={!!maxima && ref >= maxima}
                className="rounded-md border border-line p-1.5 text-navy-800 hover:bg-surface disabled:opacity-40"
                title="Dia seguinte"
              >
                <IconSetaDireita size={13} />
              </button>
            </div>
          </label>
          {dados && (
            <div className="flex flex-col gap-0.5 pb-0.5 text-[11.5px] text-muted">
              <span>
                Semana de {fmtDateBR(dados.semana[0])} a {fmtDateBR(dados.semana[6])} · Mês desde {fmtDateBR(dados.mesInicio)}
              </span>
              <span>
                Safra das operações {dados.safraOperacoes ? `${dados.safraOperacoes.rotulo} desde ${fmtDateBR(dados.safraOperacoes.inicio)}` : "sem safra cadastrada (desde 01/01)"} · Moagem{" "}
                {dados.safraMoagem ? `${dados.safraMoagem.rotulo} desde ${fmtDateBR(dados.safraMoagem.inicio)}` : "sem safra em produção (desde 01/01)"}
              </span>
            </div>
          )}
          <BotaoLimparFiltros ativo={!!dt} onLimpar={() => setDt("")} className="ml-auto" />
        </div>

        {erro && <div className="mb-4 rounded-lg border border-alert-500/30 bg-alert-50 px-4 py-3 text-[13px] text-alert-600">{erro}</div>}
        {!dados && carregando && <div className="py-10 text-center text-[13px] text-muted">Carregando…</div>}

        {dados && (
          <div className={carregando ? "opacity-60 transition-opacity" : ""}>
            <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Kpi rotulo={`Moagem do dia · ${dm(dados.dt)}`} valor={dados.moagem.total.dias[dados.semana.indexOf(dados.dt)] ?? 0} unidade="t" tom="azul" />
              <Kpi rotulo="Moagem na semana" valor={dados.moagem.total.semana} unidade="t" tom="azul" />
              <Kpi rotulo={`Moagem no mês · ${mesRotulo}`} valor={dados.moagem.total.mes} unidade="t" tom="azul" />
              <Kpi rotulo={`Moagem na safra${dados.safraMoagem ? ` · ${dados.safraMoagem.rotulo}` : ""}`} valor={dados.moagem.total.safra} unidade="t" tom="azul" />
              <Kpi rotulo={`Operações no dia · ${dm(dados.dt)}`} valor={dados.operacoes.total.dias[dados.semana.indexOf(dados.dt)] ?? 0} unidade="ha" tom="verde" />
              <Kpi rotulo="Operações na semana" valor={dados.operacoes.total.semana} unidade="ha" tom="verde" />
              <Kpi rotulo={`Operações no mês · ${mesRotulo}`} valor={dados.operacoes.total.mes} unidade="ha" tom="verde" />
              <Kpi rotulo={`Operações na safra${dados.safraOperacoes ? ` · ${dados.safraOperacoes.rotulo}` : ""}`} valor={dados.operacoes.total.safra} unidade="ha" tom="verde" />
            </div>

            <Tabela
              titulo="Moagem · entrada de cana (t)"
              descricao="Toneladas entregues por frente, de todas as viagens da pesagem (com ou sem ordem de corte, como a CMAA), em dias inteiros até ontem — sem o dia atual até as 06:00."
              rotulo="Frente"
              dados={dados}
              mesRotulo={mesRotulo}
              safraRotulo={dados.safraMoagem?.rotulo ?? "Safra"}
            >
              {dados.moagem.frentes.map((f, i) => (
                <Linha key={f.frente} rotulo={f.frente} v={f} dados={dados} estilo={i % 2 ? "par" : "impar"} />
              ))}
              {dados.moagem.frentes.length === 0 ? (
                <Vazio texto="Sem entrada de cana no período." />
              ) : (
                <Linha rotulo="Total moagem" v={dados.moagem.total} dados={dados} estilo="total" />
              )}
            </Tabela>

            <Tabela
              titulo="Operações · área realizada (ha)"
              descricao="Área dos apontamentos diários lançados, por grupo (cadastro Grupos de Operações); nome da operação pelo cadastro Operações."
              rotulo="Operação"
              dados={dados}
              mesRotulo={mesRotulo}
              safraRotulo={dados.safraOperacoes?.rotulo ?? "Safra"}
            >
              {dados.operacoes.grupos.map((g) => (
                <Fragment key={g.grupo}>
                  <tr className="border-t-2 border-navy-900/70 bg-brand-50">
                    <td colSpan={11} className="px-3 py-1 text-[12px] font-bold uppercase tracking-wide text-navy-900">
                      {g.grupo}
                    </td>
                  </tr>
                  {g.linhas.map((l, i) => (
                    <Linha
                      key={`${l.cod}-${l.ds}`}
                      rotulo={
                        <>
                          {l.cod && <span className="mr-1.5 tabular text-muted">{l.cod}</span>}
                          {l.ds}
                        </>
                      }
                      v={l}
                      dados={dados}
                      estilo={i % 2 ? "par" : "impar"}
                    />
                  ))}
                  <Linha rotulo="Subtotal" v={g.subtotal} dados={dados} estilo="subtotal" />
                </Fragment>
              ))}
              {dados.operacoes.grupos.length === 0 ? (
                <Vazio texto="Sem apontamento de operação no período." />
              ) : (
                <Linha rotulo="Total geral" v={dados.operacoes.total} dados={dados} estilo="total" />
              )}
            </Tabela>
            <p className="-mt-2 mb-4 text-[11px] text-muted">
              O dashboard vai até ontem (dias fechados); os dias depois da data de referência ficam em branco e Semana, Mês e Safra acumulam até
              ela. Operação sem grupo no cadastro Grupos de Operações aparece em &quot;{GRUPO_OUTRAS}&quot;.
            </p>
          </div>
        )}
      </div>

      {gruposAberto && (
        <GruposModal
          onFechar={() => setGruposAberto(false)}
          onAlterado={() => setVersao((v) => v + 1)}
        />
      )}
    </div>
  );
}

function Kpi({ rotulo, valor, unidade, tom }: { rotulo: string; valor: number; unidade: string; tom: "azul" | "verde" }) {
  const cor = tom === "azul" ? "border-brand-200/60 bg-brand-50 text-brand-800" : "border-good-500/25 bg-good-50 text-good-600";
  return (
    <div className={`rounded-xl2 border px-4 py-3 ${cor}`}>
      <div className="truncate text-[11.5px] font-semibold text-ink/70">{rotulo}</div>
      <div className="mt-1 text-[22px] font-extrabold tabular leading-tight">
        {nf(valor)} <span className="text-[12px] font-semibold opacity-70">{unidade}</span>
      </div>
    </div>
  );
}

function Tabela({
  titulo,
  descricao,
  rotulo,
  dados,
  mesRotulo,
  safraRotulo,
  children,
}: {
  titulo: string;
  descricao: string;
  rotulo: string;
  dados: DashboardAtividades;
  mesRotulo: string;
  safraRotulo: string;
  children: ReactNode;
}) {
  return (
    <div className="mb-5 overflow-x-auto rounded-xl2 border border-line bg-card shadow-card">
      <div className="border-b border-line px-3 py-1.5">
        <div className="text-[13px] font-bold text-ink">{titulo}</div>
        <div className="text-[11px] text-muted">{descricao}</div>
      </div>
      {/* colunas fixas: as duas tabelas ficam alinhadas uma embaixo da outra */}
      <table className="w-full min-w-[1040px] table-fixed text-[12px] leading-tight">
        <colgroup>
          <col className="w-[290px]" />
          {Array.from({ length: 10 }, (_, i) => (
            <col key={i} />
          ))}
        </colgroup>
        <thead>
          <tr className="text-center text-[10.5px] font-semibold uppercase tracking-wide text-white">
            <th className="bg-navy-900 px-3 py-1" />
            <th colSpan={7} className="border-l border-white/25 bg-navy-700 px-2 py-1">
              Semana de referência · {dm(dados.semana[0])} a {dm(dados.semana[6])}
            </th>
            <th colSpan={3} className="border-l border-white/25 bg-navy-950 px-2 py-1">
              Acumulado
            </th>
          </tr>
          <tr className="bg-navy-900 text-white">
            <th className="px-3 py-1.5 text-left font-semibold">{rotulo}</th>
            {dados.semana.map((d, i) => (
              <th
                key={d}
                className={`whitespace-nowrap px-2 py-1.5 text-right text-[11px] font-semibold ${i === 0 ? "border-l border-white/25" : ""} ${
                  d === dados.dt ? "bg-brand-600" : d > dados.dt ? "text-white/45" : ""
                }`}
              >
                {DIAS[i]} {dm(d)}
              </th>
            ))}
            <th className="whitespace-nowrap border-l border-white/25 px-2 py-1.5 text-right text-[11px] font-semibold">Semana</th>
            <th className="whitespace-nowrap px-2 py-1.5 text-right text-[11px] font-semibold">Mês · {mesRotulo}</th>
            <th className="whitespace-nowrap px-3 py-1.5 text-right text-[11px] font-semibold">{safraRotulo}</th>
          </tr>
        </thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

function Linha({
  rotulo,
  v,
  dados,
  estilo,
  recuo,
}: {
  rotulo: ReactNode;
  v: ValoresPeriodo;
  dados: DashboardAtividades;
  estilo: "impar" | "par" | "destaque" | "subtotal" | "total";
  recuo?: boolean;
}) {
  const linha = {
    impar: "bg-card text-ink",
    par: "bg-surface text-ink",
    destaque: "bg-brand-50 font-bold text-navy-900",
    subtotal: "bg-navy-900 font-semibold text-white",
    total: "bg-navy-950 font-bold text-white",
  }[estilo];
  const escuro = estilo === "subtotal" || estilo === "total";
  return (
    <tr className={`border-b border-line/60 ${linha}`}>
      <td className={`truncate py-1 pr-3 ${recuo ? "pl-6" : "pl-3"}`}>{rotulo}</td>
      {v.dias.map((x, i) => {
        const d = dados.semana[i];
        const doDia = d === dados.dt;
        return (
          <td
            key={d}
            className={`px-2 py-1 text-right tabular ${i === 0 ? `border-l ${escuro ? "border-white/20" : "border-line"}` : ""} ${
              doDia ? (escuro ? "bg-white/10 font-bold" : "bg-brand-100/70 font-semibold") : ""
            }`}
          >
            {cel(x)}
          </td>
        );
      })}
      <td className={`border-l px-2 py-1 text-right tabular font-semibold ${escuro ? "border-white/20" : "border-line"}`}>{cel(v.semana)}</td>
      <td className="px-2 py-1 text-right tabular">{cel(v.mes)}</td>
      <td className="px-3 py-1 text-right tabular">{cel(v.safra)}</td>
    </tr>
  );
}

function Vazio({ texto }: { texto: string }) {
  return (
    <tr>
      <td colSpan={11} className="px-3 py-4 text-center text-[12.5px] text-muted">
        {texto}
      </td>
    </tr>
  );
}

/** Ajuste do grupo de cada operação (vale para o dashboard inteiro; cada alteração vai para o log). */
function GruposModal({ onFechar, onAlterado }: { onFechar: () => void; onAlterado: () => void }) {
  const [lista, setLista] = useState<{ operacoes: OperacaoGrupo[]; grupos: string[] } | null>(null);
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [novo, setNovo] = useState<{ cod: string; nome: string } | null>(null);

  useEffect(() => {
    fetch("/api/atividades/dashboard/grupos", { cache: "no-store" })
      .then((r) => r.json())
      .then(setLista)
      .catch(() => setErro("Não foi possível carregar as operações."));
  }, []);

  async function salvar(cod: string, grupo: string) {
    setSalvando(cod);
    setErro(null);
    try {
      const r = await fetch("/api/atividades/dashboard/grupos", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cod, grupo }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error);
      setLista(j);
      setNovo(null);
      onAlterado();
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : "Não foi possível salvar o grupo.");
    } finally {
      setSalvando(null);
    }
  }

  const termo = busca.trim().toLowerCase();
  const ops = useMemo(
    () => (lista?.operacoes ?? []).filter((o) => !termo || `${o.cod} ${o.ds} ${o.classificacao} ${o.grupo}`.toLowerCase().includes(termo)),
    [lista, termo]
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 px-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl2 bg-card shadow-pop">
        <div className="flex items-center justify-between border-b border-line px-5 py-3">
          <div>
            <h2 className="text-[16px] font-bold text-ink">Grupos das operações</h2>
            <p className="text-[12px] text-muted">
              Grava no cadastro{" "}
              <a href="/configuracoes/cadastros/grupos-operacoes" className="font-medium text-brand-700 underline-offset-2 hover:underline">
                Grupos de Operações
              </a>
              ; vale na hora e fica no log. Só operações do cadastro Operações podem ter grupo.
            </p>
          </div>
          <button type="button" onClick={onFechar} className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface" aria-label="Fechar">
            ×
          </button>
        </div>
        <div className="flex items-center gap-2 px-5 py-2.5">
          <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar código, operação ou grupo…" className={`${FILTRO} w-full`} />
        </div>
        {erro && <div className="mx-5 mb-2 rounded-md bg-alert-50 px-3 py-2 text-[12.5px] text-alert-600">{erro}</div>}
        <div className="flex-1 overflow-y-auto px-5 pb-4">
          {!lista ? (
            <div className="py-8 text-center text-[13px] text-muted">Carregando…</div>
          ) : (
            <table className="w-full text-[12.5px]">
              <thead className="sticky top-0 bg-card">
                <tr className="border-b border-line text-left text-[11px] text-muted">
                  <th className="py-1.5 pr-2 font-semibold">Cód.</th>
                  <th className="py-1.5 pr-2 font-semibold">Operação</th>
                  <th className="py-1.5 pr-2 font-semibold">Classificação</th>
                  <th className="py-1.5 font-semibold">Grupo</th>
                </tr>
              </thead>
              <tbody>
                {ops.map((o) => (
                  <tr key={o.cod} className="border-b border-line/60">
                    <td className="py-1 pr-2 tabular text-muted">{o.cod}</td>
                    <td className="py-1 pr-2 text-ink">
                      {o.ds}
                      {!o.lancada && <span className="ml-1.5 text-[11px] text-muted">sem lançamento</span>}
                    </td>
                    <td className="py-1 pr-2 text-[12px] text-muted">{o.classificacao}</td>
                    <td className="py-1">
                      {!o.noCadastro ? (
                        <span className="text-[11.5px] text-alert-600">Fora do cadastro Operações</span>
                      ) : novo?.cod === o.cod ? (
                        <form
                          className="flex items-center gap-1.5"
                          onSubmit={(e) => {
                            e.preventDefault();
                            if (novo.nome.trim()) salvar(o.cod, novo.nome);
                          }}
                        >
                          <input
                            autoFocus
                            value={novo.nome}
                            onChange={(e) => setNovo({ cod: o.cod, nome: e.target.value })}
                            placeholder="Nome do novo grupo"
                            className={`${FILTRO} w-48 py-1`}
                          />
                          <button type="submit" className="rounded-md bg-navy-900 px-2.5 py-1 text-[12px] font-medium text-white hover:bg-navy-800">
                            Salvar
                          </button>
                          <button type="button" onClick={() => setNovo(null)} className="px-1.5 text-[12px] text-muted hover:text-ink">
                            Cancelar
                          </button>
                        </form>
                      ) : (
                        <select
                          value={o.grupo}
                          disabled={salvando === o.cod}
                          onChange={(e) => (e.target.value === "__novo" ? setNovo({ cod: o.cod, nome: "" }) : salvar(o.cod, e.target.value))}
                          className={`${FILTRO} w-full py-1 ${o.grupo === GRUPO_OUTRAS ? "text-muted" : ""}`}
                        >
                          {lista.grupos.map((g) => (
                            <option key={g} value={g}>
                              {g}
                            </option>
                          ))}
                          <option value={GRUPO_OUTRAS}>{GRUPO_OUTRAS}</option>
                          <option value="__novo">+ Novo grupo…</option>
                        </select>
                      )}
                    </td>
                  </tr>
                ))}
                {ops.length === 0 && (
                  <tr>
                    <td colSpan={4} className="py-6 text-center text-muted">
                      Nenhuma operação encontrada.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
