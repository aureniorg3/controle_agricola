"use client";

import { Fragment, useEffect, useMemo, useState } from "react";
import BotaoLimparFiltros from "@/components/BotaoLimparFiltros";
import { IconAjustes, IconImprimir, IconSetaDireita, IconSetaEsquerda } from "@/components/icons";
import { JanelaInfo } from "@/components/janela";
import { Abas, BarraFiltros, CabecalhoPagina, Comando, CorpoPagina, Indicador, Pagina, Painel } from "@/components/pagina";
import { GRUPO_OUTRAS } from "@/lib/dashboard-atividades";
import { fmtDateBR } from "@/lib/format";
import { addDays } from "@/lib/period";
import { podeEditar } from "@/lib/permissoes";
import { BotaoExportar } from "@/app/(app)/acompanhamentos/os-agricola/comum";

const FILTRO = "rounded-md border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink focus:border-brand-600 focus:outline-none";
const nf = (n) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cel = (n) => (n === null ? "" : Math.abs(n) < 0.005 ? "–" : nf(n));
const DIAS = ["seg", "ter", "qua", "qui", "sex", "sáb", "dom"];
const dm = (iso) => fmtDateBR(iso).slice(0, 5);
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];

/** Atividades › Dashboard: entrada de cana por frente e área das operações lançadas, dia a dia na semana e acumulados. */
export default function DashboardAtividadesClient({ perfil, nomeUsuario }) {
  const [dt, setDt] = useState("");
  const [dados, setDados] = useState(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [gruposAberto, setGruposAberto] = useState(false);
  const [versao, setVersao] = useState(0);
  const [gerandoPdf, setGerandoPdf] = useState(false);
  /** janela (detalhe) do card aberta: { tipo: "moagem" | "operacoes", periodo: "dia" | "semana" | "mes" | "safra" } */
  const [janela, setJanela] = useState(null);

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
  const mudarDia = (delta) => ref && (delta < 0 || ref < maxima) && setDt(addDays(ref, delta));
  const mesRotulo = ref ? `${MESES[Number(ref.slice(5, 7)) - 1]}/${ref.slice(2, 4)}` : "";

  // caixas do topo: cada uma abre a janela com o detalhe que forma o número (mesma data de referência)
  const iDia = dados ? dados.semana.indexOf(dados.dt) : -1;
  const cards = dados
    ? [
        { tipo: "moagem", periodo: "dia", rotulo: `Moagem do dia · ${dm(dados.dt)}`, valor: dados.moagem.total.dias[iDia] ?? 0, unidade: "t", tom: "azul" },
        { tipo: "moagem", periodo: "semana", rotulo: "Moagem na semana", valor: dados.moagem.total.semana, unidade: "t", tom: "azul" },
        { tipo: "moagem", periodo: "mes", rotulo: `Moagem no mês · ${mesRotulo}`, valor: dados.moagem.total.mes, unidade: "t", tom: "azul" },
        {
          tipo: "moagem",
          periodo: "safra",
          rotulo: `Moagem na safra${dados.safraMoagem ? ` · ${dados.safraMoagem.rotulo}` : ""}`,
          valor: dados.moagem.total.safra,
          unidade: "t",
          tom: "azul",
        },
        {
          tipo: "operacoes",
          periodo: "dia",
          rotulo: `Operações no dia · ${dm(dados.dt)}`,
          valor: dados.operacoes.total.dias[iDia] ?? 0,
          unidade: "ha",
          tom: "verde",
        },
        { tipo: "operacoes", periodo: "semana", rotulo: "Operações na semana", valor: dados.operacoes.total.semana, unidade: "ha", tom: "verde" },
        { tipo: "operacoes", periodo: "mes", rotulo: `Operações no mês · ${mesRotulo}`, valor: dados.operacoes.total.mes, unidade: "ha", tom: "verde" },
        {
          tipo: "operacoes",
          periodo: "safra",
          rotulo: `Operações na safra${dados.safraOperacoes ? ` · ${dados.safraOperacoes.rotulo}` : ""}`,
          valor: dados.operacoes.total.safra,
          unidade: "ha",
          tom: "verde",
        },
      ]
    : [];
  const cardAberto = janela && cards.find((c) => c.tipo === janela.tipo && c.periodo === janela.periodo);
  const baseJanela = dados && {
    dados,
    mesRotulo,
    onFechar: () => setJanela(null),
    // clique num dia dentro da janela: o dashboard passa a ter esse dia como data de referência
    onData: (d) => {
      setDt(d);
      setJanela(null);
    },
  };

  return (
    <Pagina>
      <CabecalhoPagina
        titulo="Dashboard"
        categoria="Atividades"
        comandos={
          <>
            <Comando icone={<IconImprimir size={16} />} onClick={gerarPdf} disabled={!dados || carregando || gerandoPdf}>
              {gerandoPdf ? "Gerando…" : "Gerar PDF"}
            </Comando>
            {podeEditar(perfil) && (
              <Comando icone={<IconAjustes size={16} />} onClick={() => setGruposAberto(true)}>
                Grupos das operações
              </Comando>
            )}
          </>
        }
      />

      <CorpoPagina>
        <BarraFiltros>
          <label className="flex flex-col gap-1 text-[11.5px] text-muted">
            Data de referência
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => mudarDia(-1)}
                className="rounded-md border border-line p-1.5 text-navy-800 hover:bg-surface"
                title="Dia anterior"
              >
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
                Safra das operações{" "}
                {dados.safraOperacoes ? `${dados.safraOperacoes.rotulo} desde ${fmtDateBR(dados.safraOperacoes.inicio)}` : "sem safra cadastrada (desde 01/01)"}{" "}
                · Moagem{" "}
                {dados.safraMoagem ? `${dados.safraMoagem.rotulo} desde ${fmtDateBR(dados.safraMoagem.inicio)}` : "sem safra em produção (desde 01/01)"}
              </span>
            </div>
          )}
          <BotaoLimparFiltros ativo={!!dt} onLimpar={() => setDt("")} className="ml-auto" />
        </BarraFiltros>

        {erro && <div className="mb-4 rounded-lg border border-alert-500/30 bg-alert-50 px-4 py-3 text-[13px] text-alert-600">{erro}</div>}
        {!dados && carregando && <div className="py-10 text-center text-[13px] text-muted">Carregando…</div>}

        {dados && (
          <div className={carregando ? "opacity-60 transition-opacity" : ""}>
            {/* cada card abre a janela com o detalhe do mesmo número (mesma data de referência) */}
            <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {cards.map((c) => (
                <button
                  key={`${c.tipo}-${c.periodo}`}
                  type="button"
                  onClick={() => setJanela({ tipo: c.tipo, periodo: c.periodo })}
                  className="min-w-0 rounded-xl2 text-left transition hover:-translate-y-px focus:outline-none focus-visible:ring-2 focus-visible:ring-navy-500"
                  title={`Ver o detalhe · ${c.rotulo}`}
                >
                  <Kpi rotulo={c.rotulo} valor={c.valor} unidade={c.unidade} tom={c.tom} />
                </button>
              ))}
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
              O dashboard vai até ontem (dias fechados); os dias depois da data de referência ficam em branco e Semana, Mês e Safra acumulam até ela. Operação
              sem grupo no cadastro Grupos de Operações aparece em &quot;{GRUPO_OUTRAS}&quot;.
            </p>
          </div>
        )}
      </CorpoPagina>

      {cardAberto?.tipo === "moagem" && <JanelaMoagem key={cardAberto.periodo} card={cardAberto} base={baseJanela} />}
      {cardAberto?.tipo === "operacoes" && <JanelaOperacoes key={cardAberto.periodo} card={cardAberto} base={baseJanela} />}
      {gruposAberto && <GruposModal onFechar={() => setGruposAberto(false)} onAlterado={() => setVersao((v) => v + 1)} />}
    </Pagina>
  );
}

/** Caixa do topo (dentro do botão que abre a janela; o rótulo inteiro vai no title do botão). */
function Kpi({ rotulo, valor, unidade, tom }) {
  return <Indicador cor={tom} rotulo={rotulo} valor={nf(valor)} unidade={unidade} className="h-full" />;
}

function Tabela({ titulo, descricao, rotulo, dados, mesRotulo, safraRotulo, children }) {
  return (
    <Painel className="mb-5" titulo={titulo} subtitulo={descricao} semEspaco>
      <div className="overflow-x-auto">
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
                  className={`whitespace-nowrap px-2 py-1 text-right text-[11px] font-semibold leading-tight ${i === 0 ? "border-l border-white/25" : ""} ${
                    d === dados.dt ? "bg-brand-600" : d > dados.dt ? "text-white/45" : ""
                  }`}
                >
                  {/* dia da semana em cima (caixa alta) e a data embaixo */}
                  <div>{DIAS[i].toUpperCase()}</div>
                  <div className="font-normal">{dm(d)}</div>
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
    </Painel>
  );
}

function Linha({ rotulo, v, dados, estilo, recuo }) {
  const linha = {
    impar: "bg-card text-ink",
    par: "bg-surface text-ink",
    destaque: "bg-brand-50 font-bold text-navy-900",
    subtotal: "linha-subtotal",
    total: "bg-navy-950 font-bold text-white",
  }[estilo];
  const escuro = estilo === "total";
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

function Vazio({ texto }) {
  return (
    <tr>
      <td colSpan={11} className="px-3 py-4 text-center text-[12.5px] text-muted">
        {texto}
      </td>
    </tr>
  );
}

/* ---------- Janelas dos cards: o detalhe que forma o número de cada caixa, na mesma data de referência ---------- */

const int = (n) => (n ?? 0).toLocaleString("pt-BR");
const pct = (v, total) => (total > 0 ? Math.round((v / total) * 1000) / 10 : null);
const temValor = (n) => Math.abs(n ?? 0) >= 0.005;
const NO_PERIODO = { dia: "no dia", semana: "na semana", mes: "no mês", safra: "na safra" };
/** dia da semana (seg…dom) de uma data ISO */
const diaDaSemana = (iso) => DIAS[(new Date(`${iso}T12:00:00Z`).getUTCDay() + 6) % 7];
/** valor de uma linha do dashboard no período do card: o dia da referência ou o acumulado (semana, mês, safra) */
const doPeriodo = (v, periodo, iDia) => (periodo === "dia" ? (v.dias[iDia] ?? 0) : v[periodo]);

/** Período do card (subtítulo da janela): de quando a quando vai o número — sempre até a data de referência. */
function periodoDoCard(dados, tipo, periodo, mesRotulo) {
  const ref = fmtDateBR(dados.dt);
  if (periodo === "dia") return `Dia ${ref} (data de referência)`;
  const safra = tipo === "moagem" ? dados.safraMoagem : dados.safraOperacoes;
  const de = { semana: dados.semana[0], mes: dados.mesInicio, safra: safra?.inicio ?? `${dados.dt.slice(0, 4)}-01-01` }[periodo];
  const nome = {
    semana: "Semana",
    mes: `Mês ${mesRotulo}`,
    safra: safra?.rotulo ?? (tipo === "moagem" ? "Sem safra em produção" : "Sem safra cadastrada"),
  }[periodo];
  return `${nome} · de ${fmtDateBR(de)} até a data de referência ${ref}`;
}

/** Valor na tela: toneladas e hectares (2 casas), contagem, percentual (1 casa), código ou texto. */
function formatar(num, v) {
  if (num === "int") return int(v);
  if (num === "pct") return v === null || v === undefined ? "–" : `${v.toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
  if (num === "t" || num === "ha") return nf(v ?? 0);
  return v ?? "";
}

/**
 * Tabela das janelas: cabeçalho, números à direita e linha de total (fica no fim ao ordenar pelo título da coluna).
 * Coluna: { rotulo, valor(l) (o que vai para a planilha), num ("t", "ha", "int", "pct", "cod" = à direita), exibir(l)
 * (o que aparece, se diferente do valor), classe(l), dica(l), total }.
 */
function TabelaJanela({ colunas, linhas, chave, vazio }) {
  const inicioTotal = colunas.findIndex((c) => c.total !== undefined);
  return (
    <div className="overflow-x-auto rounded-lg border border-line">
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="whitespace-nowrap border-b border-line bg-surface text-left text-muted">
            {colunas.map((c) => (
              <th key={c.rotulo} className={`px-3 py-2 font-medium ${c.num ? "text-right" : ""}`}>
                {c.rotulo}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={chave(l)} className="border-t border-line/60 hover:bg-surface/60">
              {colunas.map((c) => (
                <td key={c.rotulo} className={`px-3 py-1.5 ${c.num ? "text-right tabular" : ""} ${c.classe?.(l) ?? "text-ink"}`} title={c.dica?.(l)}>
                  {c.exibir ? c.exibir(l) : formatar(c.num, c.valor(l))}
                </td>
              ))}
            </tr>
          ))}
          {linhas.length === 0 && (
            <tr>
              <td colSpan={colunas.length} className="px-4 py-8 text-center text-muted">
                {vazio}
              </td>
            </tr>
          )}
          {linhas.length > 0 && inicioTotal > 0 && (
            <tr className="bg-navy-900 font-semibold text-white">
              <td colSpan={inicioTotal} className="px-3 py-2">
                Total
              </td>
              {colunas.slice(inicioTotal).map((c) => (
                <td key={c.rotulo} className={`px-3 py-2 ${c.num ? "text-right tabular" : ""}`}>
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

function Nota({ children, aviso = false }) {
  return (
    <p
      className={`mb-3 text-[12px] leading-relaxed ${aviso ? "rounded-md border border-amber-500/40 bg-amber-50 px-3 py-2 text-amber-800" : "text-muted"}`}
    >
      {children}
    </p>
  );
}

/** Detalhe do card que vem do servidor (quebras por dia e por fazenda, viagens ou apontamentos), na data de referência. */
function useDetalhe(dt, tipo, periodo) {
  const [det, setDet] = useState(null);
  const [erro, setErro] = useState(null);
  useEffect(() => {
    let ativo = true;
    fetch(`/api/atividades/dashboard?dt=${dt}&detalhe=${tipo}&periodo=${periodo}`, { cache: "no-store" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ativo) return;
        if (!ok) return setErro(j.error ?? "Não foi possível carregar o detalhe.");
        setDet(j);
      })
      .catch(() => ativo && setErro("Não foi possível carregar o detalhe."));
    return () => {
      ativo = false;
    };
  }, [dt, tipo, periodo]);
  return { det, erro };
}

/** Coluna Data das quebras por dia: o clique leva o dashboard para esse dia (data de referência). */
const colData = (onData) => ({
  rotulo: "Data",
  valor: (x) => fmtDateBR(x.d),
  exibir: (x) => (
    <button
      type="button"
      onClick={() => onData(x.d)}
      className="text-left font-medium text-[#2E5FA8] hover:underline"
      title={`Ver o dashboard com a data de referência ${fmtDateBR(x.d)}`}
    >
      {fmtDateBR(x.d)}
    </button>
  ),
});
const colDiaSemana = { rotulo: "Dia", valor: (x) => diaDaSemana(x.d), classe: () => "text-muted" };

/**
 * Moldura das janelas dos cards: o número da caixa no título, o período no subtítulo, as abas (as quebras do número) e
 * o exportar da aba aberta no topo. Tabela da aba: { nome, colunas, linhas, chave, vazio }; linhas nulas = ainda
 * carregando do servidor (ou erro). O erro do detalhe aparece acima das abas em todas elas, inclusive nas que usam só
 * os dados do dashboard (mas têm colunas do servidor, como as viagens por frente).
 */
function JanelaCard({ card, base, titulo, abas, aba, onAba, tabela, erro, notas }) {
  const { dados } = base;
  return (
    <JanelaInfo
      titulo={`${titulo} · ${nf(card.valor)} ${card.unidade}`}
      subtitulo={periodoDoCard(dados, card.tipo, card.periodo, base.mesRotulo)}
      largura="6xl"
      onFechar={base.onFechar}
      acoes={
        tabela.linhas?.length > 0 && (
          <BotaoExportar
            nome={`Dashboard Atividades ${dados.dt} - ${titulo} ${tabela.nome}`}
            colunas={tabela.colunas.map(({ rotulo, valor }) => ({ rotulo, valor }))}
            buscar={async () => tabela.linhas}
          />
        )
      }
    >
      {notas}
      {erro && <p className="mb-3 rounded-md border border-alert-500/40 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-600">{erro}</p>}
      <Abas itens={abas} ativo={aba} onChange={onAba} className="mb-3" />
      {tabela.linhas ? (
        <TabelaJanela colunas={tabela.colunas} linhas={tabela.linhas} chave={tabela.chave} vazio={tabela.vazio} />
      ) : erro ? (
        <div className="py-8 text-center text-[13px] text-muted">Esta aba depende do detalhe, que não carregou. Feche e abra a janela de novo.</div>
      ) : (
        <div className="py-8 text-center text-[13px] text-muted">Carregando…</div>
      )}
    </JanelaInfo>
  );
}

/** Aviso quando o detalhe (lido agora) não soma o número da caixa (lido ao abrir a tela), além do arredondamento das linhas. */
function AvisoDivergencia({ det, valor, unidade, linhas }) {
  if (!det || Math.abs(det.total - valor) <= 0.01 + 0.005 * linhas) return null;
  return (
    <Nota aviso>
      Os lançamentos mudaram depois que o dashboard foi carregado: o detalhe soma {nf(det.total)} {unidade}. Atualize a tela para os números baterem.
    </Nota>
  );
}

/**
 * Card de moagem: toneladas por frente (do próprio dashboard), por dia, por fazenda e, no dia, cada viagem — as mesmas
 * viagens da pesagem que formam o número.
 */
function JanelaMoagem({ card, base }) {
  const { dados } = base;
  const { periodo, valor } = card;
  const { det, erro } = useDetalhe(dados.dt, "moagem", periodo);
  const [aba, setAba] = useState("frente");
  const iDia = dados.semana.indexOf(dados.dt);
  const viagensDaFrente = useMemo(() => new Map((det?.porFrente ?? []).map((f) => [f.frente, f.viagens])), [det]);
  // toneladas do próprio dashboard; com o detalhe, entram também as frentes só com viagens de 0 t (pesagem sem
  // tonelagem), que não aparecem no dashboard mas estão nas abas Por dia e Por fazenda — assim as viagens batem
  const frentes = useMemo(() => {
    const lista = dados.moagem.frentes.map((f) => ({ frente: f.frente, t: doPeriodo(f, periodo, iDia) })).filter((f) => temValor(f.t));
    const mostradas = new Set(lista.map((f) => f.frente));
    for (const f of det?.porFrente ?? []) {
      if (!mostradas.has(f.frente) && f.viagens > 0 && !temValor(f.t)) lista.push({ frente: f.frente, t: 0, semTonelagem: true });
    }
    return lista.sort((a, b) => b.t - a.t || a.frente.localeCompare(b.frente));
  }, [dados, periodo, iDia, det]);
  // total da coluna Viagens: a soma das linhas mostradas (sem o detalhe, fica em branco)
  const nViagensFrentes = det ? frentes.reduce((s, f) => s + (viagensDaFrente.get(f.frente) ?? 0), 0) : undefined;
  const colT = { rotulo: "Toneladas (t)", num: "t", valor: (x) => x.t, total: valor };
  const colPct = { rotulo: "% do total", num: "pct", valor: (x) => pct(x.t, valor), total: valor > 0 ? 100 : null, classe: () => "text-muted" };
  const colViagens = { rotulo: "Viagens", num: "int", valor: (x) => x.viagens, total: det ? det.porDia.reduce((s, x) => s + x.viagens, 0) : undefined };
  const semEntrada = "Sem entrada de cana no período.";
  const tabelas = {
    frente: {
      nome: "por frente",
      colunas: [
        {
          rotulo: "Frente",
          valor: (f) => f.frente,
          classe: (f) => (f.semTonelagem ? "font-medium text-muted" : "font-medium text-ink"),
          dica: (f) => (f.semTonelagem ? "Só viagens sem tonelagem (0 t) no período: não somam no número da caixa." : undefined),
        },
        {
          ...colViagens,
          total: nViagensFrentes,
          valor: (f) => (det ? (viagensDaFrente.get(f.frente) ?? 0) : null),
          exibir: (f) => (det ? int(viagensDaFrente.get(f.frente) ?? 0) : erro ? "–" : "…"),
        },
        colT,
        colPct,
      ],
      linhas: frentes,
      chave: (f) => f.frente,
      vazio: semEntrada,
    },
    dia: {
      nome: "por dia",
      colunas: [colData(base.onData), colDiaSemana, colViagens, colT, colPct],
      linhas: det?.porDia ?? null,
      chave: (x) => x.d,
      vazio: semEntrada,
    },
    fazenda: {
      nome: "por fazenda",
      colunas: [
        { rotulo: "Fazenda", num: "cod", valor: (z) => z.cod, classe: () => "font-medium text-ink" },
        { rotulo: "Descrição", valor: (z) => z.nome },
        { rotulo: "Frentes", valor: (z) => z.frentes.join(", "), classe: () => "text-muted" },
        colViagens,
        colT,
        colPct,
      ],
      linhas: det?.porFazenda ?? null,
      chave: (z) => z.cod,
      vazio: semEntrada,
    },
    viagens: {
      nome: "viagens",
      colunas: [
        { rotulo: "Hora", valor: (v) => v.hora, classe: () => "tabular text-muted" },
        { rotulo: "Controle", num: "cod", valor: (v) => v.controle },
        { rotulo: "Ordem", num: "cod", valor: (v) => v.ordem },
        { rotulo: "Frente", valor: (v) => v.frente },
        { rotulo: "Fazenda", num: "cod", valor: (v) => v.fazenda, classe: () => "font-medium text-ink" },
        { rotulo: "Descrição", valor: (v) => v.fazendaNome },
        { rotulo: "Talhão", num: "cod", valor: (v) => v.talhao },
        { rotulo: "Veículo", valor: (v) => v.veiculo, classe: () => "text-muted" },
        colT,
      ],
      linhas: det?.viagens ?? null,
      chave: (v) => `${v.ordem}|${v.controle}`,
      vazio: "Nenhuma viagem no dia.",
    },
  };
  const abas = [
    { id: "frente", label: "Por frente" },
    periodo !== "dia" && { id: "dia", label: "Por dia" },
    { id: "fazenda", label: "Por fazenda" },
    periodo === "dia" && { id: "viagens", label: det?.viagens ? `Viagens · ${int(det.viagens.length)}` : "Viagens" },
  ].filter(Boolean);
  const notas = (
    <>
      <Nota>
        Toneladas de todas as viagens da pesagem (com ou sem ordem de corte, como a CMAA), sem as viagens com tara zerada; a frente é a da ordem de corte
        e, sem ordem, a do relatório de pesagem.
        {periodo !== "dia" && " Na aba Por dia, clique na data para ver o dashboard naquele dia."}
        {frentes.some((f) => f.semTonelagem) && " Na aba Por frente, as frentes em cinza só tiveram viagens sem tonelagem (0 t)."}
      </Nota>
      {det && det.ate < dados.dt && (
        <Nota aviso>A produção da safra de moagem terminou em {fmtDateBR(det.ate)}: entradas de cana depois dessa data não contam.</Nota>
      )}
      <AvisoDivergencia det={det} valor={valor} unidade="t" linhas={dados.moagem.frentes.length} />
    </>
  );
  return (
    <JanelaCard
      card={card}
      base={base}
      titulo={`Moagem ${NO_PERIODO[periodo]}`}
      abas={abas}
      aba={aba}
      onAba={setAba}
      tabela={tabelas[aba]}
      erro={erro}
      notas={notas}
    />
  );
}

/**
 * Card de operações: área por grupo e por operação (do próprio dashboard), por dia, por fazenda e cada apontamento (no
 * dia, na semana e no mês; na safra a lista seria grande demais) — os mesmos apontamentos que formam o número.
 */
function JanelaOperacoes({ card, base }) {
  const { dados } = base;
  const { periodo, valor } = card;
  const { det, erro } = useDetalhe(dados.dt, "operacoes", periodo);
  const [aba, setAba] = useState("grupo");
  const iDia = dados.semana.indexOf(dados.dt);
  const { grupos, operacoes } = useMemo(() => {
    const g = [];
    const o = [];
    for (const x of dados.operacoes.grupos) {
      const linhas = x.linhas.map((l) => ({ grupo: x.grupo, cod: l.cod, ds: l.ds, ha: doPeriodo(l, periodo, iDia) })).filter((l) => temValor(l.ha));
      const ha = doPeriodo(x.subtotal, periodo, iDia);
      if (!temValor(ha) && linhas.length === 0) continue;
      g.push({ grupo: x.grupo, operacoes: linhas.length, ha });
      o.push(...linhas);
    }
    return { grupos: g, operacoes: o.sort((a, b) => b.ha - a.ha || a.ds.localeCompare(b.ds)) };
  }, [dados, periodo, iDia]);
  const soma = (lista, campo) => (lista ? lista.reduce((s, x) => s + x[campo], 0) : undefined);
  const colHa = { rotulo: "Área (ha)", num: "ha", valor: (x) => x.ha, total: valor };
  const colPct = { rotulo: "% do total", num: "pct", valor: (x) => pct(x.ha, valor), total: valor > 0 ? 100 : null, classe: () => "text-muted" };
  // talhões de cada apontamento (o mesmo talhão em dois apontamentos conta duas vezes)
  const colTalhoes = (lista) => ({ rotulo: "Talhões", num: "int", valor: (x) => x.talhoes, total: soma(lista, "talhoes") });
  const semApontamento = "Sem apontamento de operação no período.";
  const tabelas = {
    grupo: {
      nome: "por grupo",
      colunas: [
        { rotulo: "Grupo", valor: (g) => g.grupo, classe: () => "font-medium text-ink" },
        { rotulo: "Operações", num: "int", valor: (g) => g.operacoes, total: operacoes.length },
        colHa,
        colPct,
      ],
      linhas: grupos,
      chave: (g) => g.grupo,
      vazio: semApontamento,
    },
    operacao: {
      nome: "por operação",
      colunas: [
        { rotulo: "Grupo", valor: (o) => o.grupo, classe: () => "text-muted" },
        { rotulo: "Cód.", num: "cod", valor: (o) => o.cod, classe: () => "text-muted" },
        { rotulo: "Operação", valor: (o) => o.ds, classe: () => "font-medium text-ink" },
        colHa,
        colPct,
      ],
      linhas: operacoes,
      chave: (o) => `${o.cod}-${o.ds}`,
      vazio: semApontamento,
    },
    dia: {
      nome: "por dia",
      colunas: [
        colData(base.onData),
        colDiaSemana,
        { rotulo: "Apontamentos", num: "int", valor: (x) => x.apontamentos, total: soma(det?.porDia, "apontamentos") },
        colTalhoes(det?.porDia),
        colHa,
        colPct,
      ],
      linhas: det?.porDia ?? null,
      chave: (x) => x.d,
      vazio: semApontamento,
    },
    fazenda: {
      nome: "por fazenda",
      colunas: [
        { rotulo: "Fazenda", num: "cod", valor: (z) => z.cod, classe: () => "font-medium text-ink" },
        { rotulo: "Descrição", valor: (z) => z.nome },
        // sem total: um apontamento pode ter talhões de mais de uma fazenda
        { rotulo: "Apontamentos", num: "int", valor: (z) => z.apontamentos },
        colTalhoes(det?.porFazenda),
        colHa,
        colPct,
      ],
      linhas: det?.porFazenda ?? null,
      chave: (z) => z.cod,
      vazio: semApontamento,
    },
    apontamentos: {
      nome: "apontamentos",
      colunas: [
        periodo !== "dia" && { rotulo: "Data", valor: (a) => fmtDateBR(a.d) },
        { rotulo: "Boletim", num: "cod", valor: (a) => a.bol ?? "" },
        { rotulo: "O.S.", num: "cod", valor: (a) => a.os },
        { rotulo: "Cód.", num: "cod", valor: (a) => a.cod, classe: () => "text-muted" },
        { rotulo: "Operação", valor: (a) => a.ds, classe: () => "font-medium text-ink" },
        { rotulo: "Grupo", valor: (a) => a.grupo, classe: () => "text-muted" },
        { rotulo: "Fazenda", valor: (a) => a.fazendas.map((f) => (f.nome ? `${f.cod} · ${f.nome}` : f.cod)).join("; ") },
        colTalhoes(det?.apontamentos),
        colHa,
      ].filter(Boolean),
      linhas: det?.apontamentos ?? null,
      chave: (a) => a.id,
      vazio: semApontamento,
    },
  };
  const abas = [
    { id: "grupo", label: "Por grupo" },
    { id: "operacao", label: "Por operação" },
    periodo !== "dia" && { id: "dia", label: "Por dia" },
    { id: "fazenda", label: "Por fazenda" },
    periodo !== "safra" && { id: "apontamentos", label: det?.apontamentos ? `Apontamentos · ${int(det.apontamentos.length)}` : "Apontamentos" },
  ].filter(Boolean);
  const notas = (
    <>
      <Nota>
        Área dos talhões dos apontamentos diários lançados; o grupo de cada operação vem do cadastro Grupos de Operações
        (sem grupo, &quot;{GRUPO_OUTRAS}&quot;).
        {periodo !== "dia" && " Na aba Por dia, clique na data para ver o dashboard naquele dia."}
        {periodo === "safra" && " A lista dos apontamentos fica nas janelas do dia, da semana e do mês."}
      </Nota>
      <AvisoDivergencia det={det} valor={valor} unidade="ha" linhas={dados.operacoes.grupos.reduce((s, g) => s + g.linhas.length + 1, 0)} />
    </>
  );
  return (
    <JanelaCard
      card={card}
      base={base}
      titulo={`Operações ${NO_PERIODO[periodo]}`}
      abas={abas}
      aba={aba}
      onAba={setAba}
      tabela={tabelas[aba]}
      erro={erro}
      notas={notas}
    />
  );
}

/** Ajuste do grupo de cada operação (vale para o dashboard inteiro; cada alteração vai para o log). Os grupos vêm do cadastro Grupo Op. Dashboard. */
function GruposModal({ onFechar, onAlterado }) {
  const [lista, setLista] = useState(null);
  const [busca, setBusca] = useState("");
  const [salvando, setSalvando] = useState(null);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    fetch("/api/atividades/dashboard/grupos", { cache: "no-store" })
      .then((r) => r.json())
      .then(setLista)
      .catch(() => setErro("Não foi possível carregar as operações."));
  }, []);

  async function salvar(cod, grupo) {
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
      onAlterado();
    } catch (e) {
      setErro(e instanceof Error && e.message ? e.message : "Não foi possível salvar o grupo.");
    } finally {
      setSalvando(null);
    }
  }

  const termo = busca.trim().toLowerCase();
  const ops = useMemo(
    () => (lista?.operacoes ?? []).filter((o) => !termo || `${o.cod} ${o.ds} ${o.classificacao} ${o.grupoNome}`.toLowerCase().includes(termo)),
    [lista, termo],
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
              ; vale na hora e fica no Log de Alterações. Só operações do cadastro Operações podem ter grupo. Os grupos (nome e ordem no
              dashboard) são os do cadastro{" "}
              <a href="/configuracoes/cadastros/grupos-dashboard" className="font-medium text-brand-700 underline-offset-2 hover:underline">
                Grupo Op. Dashboard
              </a>
              .
            </p>
          </div>
          <button
            type="button"
            onClick={onFechar}
            className="flex h-7 w-7 items-center justify-center rounded-md text-muted hover:bg-surface"
            aria-label="Fechar"
          >
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
                      ) : (
                        <select
                          value={o.grupo}
                          disabled={salvando === o.cod}
                          onChange={(e) => salvar(o.cod, e.target.value)}
                          className={`${FILTRO} w-full py-1 ${o.grupo === "" ? "text-muted" : ""}`}
                        >
                          {/* grupo inativo no cadastro só aparece na operação que já está nele */}
                          {lista.grupos
                            .filter((g) => g.ativo !== false || g.cod === o.grupo)
                            .map((g) => (
                              <option key={g.cod} value={g.cod}>
                                {g.nome}
                                {g.ativo === false ? " (inativo)" : ""}
                              </option>
                            ))}
                          <option value="">{GRUPO_OUTRAS}</option>
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
