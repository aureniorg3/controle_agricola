"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BotaoCartao, BotaoLink, JanelaCard, Nota, Secao, TabelaJanela, exportarTabela, int } from "@/app/(app)/acompanhamentos/insumos/janela-detalhe";
import { IconImprimir, IconMais } from "@/components/icons";
import JanelaFormulario, { Aviso, JanelaConfirmar, JanelaInfo, useAtalhoTela, useJanela } from "@/components/janela";
import { BarraFiltros, CabecalhoPagina, Comando, CorpoPagina, Indicador, Pagina } from "@/components/pagina";
import { fmtDateBR, todayISO } from "@/lib/format";
import { gerarComunicadoEmprestimoPdf } from "@/lib/comunicado-emprestimo-pdf";
import { ASSINANTES_PADRAO, totalItem } from "@/lib/emprestimos";
import { podeEditar } from "@/lib/permissoes";
import { ehTexto, usarPersistido } from "@/lib/usar-persistido";

import BotaoLimparFiltros from "@/components/BotaoLimparFiltros";

const INPUT = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px]";
const ROTULO = "mb-1 block text-[11px] font-semibold uppercase tracking-wide text-muted";
const BOTAO = "rounded-lg border border-line bg-card px-3 py-1.5 text-[12.5px] font-semibold text-navy-800 hover:bg-surface disabled:opacity-50";

const brl = (n) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const qt = (n) => n.toLocaleString("pt-BR", { maximumFractionDigits: 3 });
const COR_STATUS = {
  Aberto: "bg-amber-50 text-amber-700",
  Devolvido: "bg-brand-50 text-brand-700",
  Pago: "bg-good-50 text-good-600",
};
/** Cor do indicador de cada situação: em aberto é pendente (laranja), devolvido azul e pago verde, como os selos da tabela. */
const COR_RESUMO = { Aberto: "laranja", Devolvido: "azul", Pago: "verde" };
const NOME_RESUMO = { Aberto: "Em aberto", Devolvido: "Devolvidos", Pago: "Pagos" };

/** Tipos do gerador de relatório (PDF): o resumo da tela ou tudo de cada empréstimo. */
const TIPOS_RELATORIO = [
  {
    v: "sintetico",
    t: "Sintético",
    d: "O resumo como na tela: os totais por situação e uma linha por empréstimo (solicitação, datas, fornecedor, fazendas, insumos, valor e situação).",
  },
  {
    v: "analitico",
    t: "Analítico",
    d: "Todos os detalhes de cada empréstimo: os insumos (código, U.M., dose, quantidade, valor unitário e total), destinatário, fazendas e área, volume, baixa, observação, origem e quem lançou, com o total de cada um.",
  },
];

/** Nº da Solicitação do empréstimo (gerado pelo sistema: ANO + MÊS + sequência no mês); sem ele, o id. */
const nSolicitacao = (e) => (e.solicitacao ? String(e.solicitacao) : `#${e.id}`);

/** O empréstimo bate com a busca da lista (fornecedor, fazenda, insumo, nº da Solicitação ou o boletim antigo)? */
function casaBusca(e, busca) {
  const q = busca.trim().toLowerCase();
  if (!q) return true;
  return [
    e.fornNm,
    e.fornCod,
    ...e.faz.map((f) => `${f.cod} ${f.nome}`),
    ...e.itens.map((i) => `${i.cod} ${i.nm}`),
    String(e.id),
    String(e.solicitacao ?? ""),
    String(e.boletim ?? ""),
  ]
    .join(" ")
    .toLowerCase()
    .includes(q);
}

const numero = (v) => (v.includes(",") ? Number(v.replace(/\./g, "").replace(",", ".")) : Number(v));
const emTexto = (n) => (n === null || n === undefined ? "" : String(n).replace(".", ","));

const itemVazio = () => ({ cod: "", nm: "", um: "", dose: "", qtd: "", vu: "" });
const fazVazia = () => ({ cod: "", nome: "", area: "" });

function formVazio() {
  return {
    fornCod: "",
    fornNm: "",
    doc: "",
    dtSol: todayISO(),
    dt: "",
    faz: [fazVazia()],
    volTipo: "Calda",
    vol: "",
    assin: [...ASSINANTES_PADRAO],
    itens: [itemVazio()],
    obs: "",
  };
}

function formDe(e) {
  return {
    id: e.id,
    // só para mostrar: o nº é do sistema
    solicitacao: e.solicitacao,
    fornCod: e.fornCod,
    fornNm: e.fornNm,
    doc: e.doc,
    dtSol: e.dtSol ?? "",
    dt: e.dt ?? "",
    faz: e.faz.map((f) => ({ cod: f.cod, nome: f.nome, area: emTexto(f.area) })),
    volTipo: e.volTipo,
    vol: e.vol,
    assin: [...e.assin],
    // doBanco: a linha como foi gravada; enquanto o código não for mexido, sair do campo não troca descrição, UM e preço
    itens: e.itens.map((i) => ({ cod: i.cod, nm: i.nm, um: i.um, dose: emTexto(i.dose), qtd: emTexto(i.qtd), vu: emTexto(i.vu), doBanco: true })),
    obs: e.obs,
  };
}

/** O que conta para saber se algo foi digitado ou alterado: os avisos do cadastro e a marca da linha gravada não contam. */
function conteudoForm(f) {
  return JSON.stringify({ ...f, itens: f.itens.map((i) => ({ ...i, cad: undefined, aviso: undefined, doBanco: undefined })) });
}

/** AAAAMM da data do formulário que dá o mês da Solicitação (a da solicitação; sem ela, a da saída; sem as duas, hoje). */
const mesDoForm = (f) => (f.dtSol || f.dt || todayISO()).slice(0, 7).replace("-", "");

export default function EmprestimosClient({ perfil, nomeUsuario = "" }) {
  const podeGravar = podeEditar(perfil);
  const [lista, setLista] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState(null);
  const [filtroStatus, setFiltroStatus] = usarPersistido("insumos.emp.status", "Aberto", ehTexto);
  const [busca, setBusca] = usarPersistido("insumos.emp.busca", "", ehTexto);
  const algumFiltroAtivo = filtroStatus !== "Aberto" || busca !== "";
  function limparFiltros() {
    setFiltroStatus("Aberto");
    setBusca("");
  }
  const [aberto, setAberto] = useState(null);
  // formulário na janela: null = fechada
  const [form, setForm] = useState(null);
  // como o formulário estava ao abrir: fechar só pergunta se algo mudou
  const [origem, setOrigem] = useState(null);
  const [baixa, setBaixa] = useState(null);
  const [salvando, setSalvando] = useState(false);
  // erro da janela de baixa
  const [erroModal, setErroModal] = useState(null);
  // mensagem do lançamento: dentro da janela enquanto aberta, na página depois de fechada
  const [msg, setMsg] = useState(null);
  const [confirmar, setConfirmar] = useState(null);
  const formRef = useRef(null);
  const fornRef = useRef(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErro(null);
    try {
      const res = await fetch("/api/emprestimos", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Não foi possível carregar os empréstimos.");
      setLista(json.emprestimos);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar os empréstimos.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  const resumo = useMemo(() => {
    const por = (s) => {
      const l = lista.filter((e) => e.status === s);
      return { n: l.length, valor: l.reduce((a, e) => a + e.total, 0) };
    };
    return { Aberto: por("Aberto"), Devolvido: por("Devolvido"), Pago: por("Pago") };
  }, [lista]);

  const filtrada = useMemo(() => lista.filter((e) => (!filtroStatus || e.status === filtroStatus) && casaBusca(e, busca)), [lista, filtroStatus, busca]);
  // os filtros da lista, no texto do relatório
  const filtrosTexto = [`Situação: ${filtroStatus ? NOME_RESUMO[filtroStatus] : "todas"}`, busca.trim() && `busca "${busca.trim()}"`].filter(Boolean).join(" · ");

  // gerador de relatório: o tipo escolhido (lembrado no aparelho) e a janela da escolha
  const [relatorio, setRelatorio] = usarPersistido("insumos.emp.relatorio", "sintetico", ehTexto);
  const [janelaRelatorio, setJanelaRelatorio] = useState(false);
  const [gerandoRelatorio, setGerandoRelatorio] = useState(false);
  const [erroRelatorio, setErroRelatorio] = useState(null);
  /** PDF dos empréstimos da lista (com os filtros da tela), sintético ou analítico. */
  async function gerarRelatorio() {
    setGerandoRelatorio(true);
    setErroRelatorio(null);
    try {
      const { gerarRelatorioEmprestimosPdf } = await import("@/lib/relatorio-emprestimos-pdf");
      await gerarRelatorioEmprestimosPdf({ emprestimos: filtrada, tipo: relatorio === "analitico" ? "analitico" : "sintetico", filtrosTexto, nomeUsuario });
      setJanelaRelatorio(false);
    } catch (e) {
      setErroRelatorio(e instanceof Error ? e.message : "Não foi possível gerar o relatório.");
    } finally {
      setGerandoRelatorio(false);
    }
  }

  /** janela (detalhe) do card aberta: a situação (Aberto, Devolvido, Pago) */
  const [janela, setJanela] = useState(null);
  /** Clique na solicitação dentro da janela: a lista passa a mostrar o empréstimo, já aberto e à vista. */
  function verNaLista(e) {
    if (filtroStatus && filtroStatus !== e.status) setFiltroStatus(e.status);
    if (!casaBusca(e, busca)) setBusca("");
    setAberto(e.id);
    setJanela(null);
    setTimeout(() => document.getElementById(`emprestimo-${e.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" }), 50);
  }

  const sugestoesForn = useMemo(() => {
    const m = new Map();
    for (const e of lista) m.set(e.fornCod, { nm: e.fornNm, doc: e.doc });
    return m;
  }, [lista]);
  const sugestoesItem = useMemo(() => {
    const m = new Map();
    for (const e of lista) for (const i of e.itens) m.set(i.cod, { nm: i.nm, um: i.um, vu: i.vu });
    return m;
  }, [lista]);

  async function chamar(metodo, corpo) {
    const res = await fetch("/api/emprestimos", { method: metodo, headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error ?? "Não foi possível concluir.");
    return json;
  }

  /** Formulário limpo para um empréstimo novo (o nº da Solicitação aparece como prévia e é dado ao gravar). */
  function limparForm() {
    const vazio = formVazio();
    setForm(vazio);
    setOrigem(conteudoForm(vazio));
  }

  // prévia do nº da Solicitação: no novo, o próximo do mês da data; na edição, só quando a data foi para outro mês
  const [previa, setPrevia] = useState(null);
  const mesForm = form ? mesDoForm(form) : "";
  const precisaPrevia = !!form && (!form.id || (!!form.solicitacao && String(form.solicitacao).slice(0, 6) !== mesForm));
  useEffect(() => {
    if (!precisaPrevia) return setPrevia(null);
    let vale = true;
    setPrevia(null);
    fetch(`/api/emprestimos?proximo=1&dt=${mesForm.slice(0, 4)}-${mesForm.slice(4)}-01`, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => vale && setPrevia(j?.solicitacao ?? null))
      .catch(() => {});
    return () => {
      vale = false;
    };
  }, [precisaPrevia, mesForm]);

  /** Novo empréstimo: formulário limpo na janela. */
  function novoEmprestimo() {
    setMsg(null);
    limparForm();
  }

  /** Editar: o empréstimo abre na janela. */
  function editar(e) {
    const f = formDe(e);
    setMsg(null);
    setForm(f);
    setOrigem(conteudoForm(f));
  }

  /** Fecha sem gravar: um erro do formulário descartado sai junto; o aviso de um lançamento anterior fica. */
  function descartarForm() {
    setForm(null);
    setMsg((m) => (m?.erro ? null : m));
  }

  /** Fechar a janela: com algo digitado ou alterado, pergunta antes de descartar. */
  function fecharForm() {
    if (!form || salvando) return;
    if (conteudoForm(form) === origem) return descartarForm();
    setConfirmar({
      titulo: form.id ? "Cancelar a edição?" : "Descartar o empréstimo?",
      texto: form.id ? "As alterações feitas não serão gravadas." : "O que foi digitado será perdido.",
      botao: "Descartar",
      perigo: true,
      acao: descartarForm,
    });
  }

  /** Volta ao topo da janela, onde fica a mensagem; com `focar`, o cursor vai para o fornecedor. */
  function irAoTopo(focar) {
    setTimeout(() => {
      if (focar) fornRef.current?.focus({ preventScroll: true });
      formRef.current?.closest(".overflow-y-auto")?.scrollTo({ top: 0 });
    }, 0);
  }

  async function salvar() {
    if (!form || salvando) return;
    setSalvando(true);
    setMsg(null);
    try {
      const json = await chamar("POST", {
        id: form.id,
        fornCod: form.fornCod,
        fornNm: form.fornNm,
        doc: form.doc,
        dtSol: form.dtSol || null,
        dt: form.dt || null,
        faz: form.faz.map((f) => ({ cod: f.cod, nome: f.nome, area: f.area.trim() ? numero(f.area) : null })),
        volTipo: form.volTipo,
        vol: form.vol,
        assin: form.assin,
        itens: form.itens.map((i) => ({
          cod: i.cod,
          nm: i.nm,
          um: i.um,
          dose: i.dose.trim() ? numero(i.dose) : null,
          qtd: numero(i.qtd),
          vu: numero(i.vu || "0"),
        })),
        obs: form.obs,
      });
      const nm = (form.fornNm ?? "").trim();
      const qual = `${json.solicitacao ? `Solicitação nº ${json.solicitacao}` : `Empréstimo #${form.id ?? json.id}`}${nm ? ` (${nm})` : ""}`;
      if (form.id) {
        // edição: a janela fecha e a mensagem fica na página
        setForm(null);
        setMsg({
          texto: json.anterior
            ? `${qual} alterada. A data foi para outro mês: a Solicitação nº ${json.anterior} passou a ser a nº ${json.solicitacao}.`
            : `${qual} alterada.`,
          erro: false,
        });
      } else {
        // novo: a janela fica aberta e limpa para lançar o próximo
        setMsg({ texto: `${qual} lançada.`, erro: false });
        limparForm();
        irAoTopo(true);
      }
      await carregar();
    } catch (e) {
      setMsg({ texto: e instanceof Error ? e.message : "Não foi possível salvar.", erro: true });
      irAoTopo(false);
    } finally {
      setSalvando(false);
    }
  }

  async function confirmarBaixa() {
    if (!baixa) return;
    setSalvando(true);
    setErroModal(null);
    try {
      await chamar("POST", { acao: "baixa", id: baixa.e.id, tipo: baixa.tipo, data: baixa.data, obs: baixa.obs });
      setBaixa(null);
      await carregar();
    } catch (e) {
      setErroModal(e instanceof Error ? e.message : "Não foi possível dar baixa.");
    } finally {
      setSalvando(false);
    }
  }

  function reabrir(e) {
    setConfirmar({
      titulo: `Reabrir a Solicitação nº ${nSolicitacao(e)} (${e.fornNm})?`,
      texto: "A baixa será desfeita.",
      botao: "Reabrir",
      acao: () => reabrirDeVez(e),
    });
  }

  async function reabrirDeVez(e) {
    try {
      await chamar("POST", { acao: "baixa", id: e.id, tipo: "Aberto" });
      await carregar();
    } catch (er) {
      setErro(er instanceof Error ? er.message : "Não foi possível reabrir.");
    }
  }

  function excluir(e) {
    setConfirmar({
      titulo: `Excluir a Solicitação nº ${nSolicitacao(e)} (${e.fornNm})?`,
      texto: "A exclusão fica registrada no Log de Alterações.",
      botao: "Excluir",
      perigo: true,
      acao: () => excluirDeVez(e),
    });
  }

  async function excluirDeVez(e) {
    try {
      await chamar("DELETE", { id: e.id });
      setAberto(null);
      await carregar();
    } catch (er) {
      setErro(er instanceof Error ? er.message : "Não foi possível excluir.");
    }
  }

  // F2 sem janela aberta: empréstimo novo (com a janela aberta, F2 grava; Esc fecha a janela de cima)
  useAtalhoTela("F2", novoEmprestimo, podeGravar);
  // janela de baixa: Esc fecha (menos enquanto grava)
  useJanela(!!baixa, { onEsc: () => !salvando && setBaixa(null) });

  const [sugestoes, setSugestoes] = useState([]);

  async function buscarSugestoes(q) {
    if (q.trim().length < 2) return setSugestoes([]);
    try {
      const res = await fetch(`/api/insumos/item?q=${encodeURIComponent(q.trim())}`, { cache: "no-store" });
      const json = await res.json();
      setSugestoes(res.ok ? json.itens : []);
    } catch {
      setSugestoes([]);
    }
  }

  /** Traz do cadastro a descrição e a UM e do Saldo de Insumos o preço médio mais recente. */
  async function aplicarItem(k, cod) {
    const c = cod.trim();
    if (!c) return;
    try {
      const res = await fetch(`/api/insumos/item?cod=${encodeURIComponent(c)}`, { cache: "no-store" });
      const json = await res.json();
      const it = res.ok ? json.item : null;
      if (!it) {
        setForm(
          (f) =>
            f && {
              ...f,
              itens: f.itens.map((x, i) =>
                i === k && x.cod.trim() === c ? { ...x, cad: false, aviso: "Código não encontrado no cadastro Material e Insumos — preencha à mão." } : x,
              ),
            },
        );
        return;
      }
      setForm(
        (f) =>
          f && {
            ...f,
            itens: f.itens.map((x, i) =>
              i === k && x.cod.trim() === c
                ? {
                    ...x,
                    cod: it.cod,
                    nm: it.ds,
                    um: it.un,
                    vu: it.preco !== null ? emTexto(Math.round(it.preco * 100) / 100) : x.vu,
                    cad: true,
                    aviso: it.preco !== null ? `Preço médio do saldo de ${fmtDateBR(it.precoData)}` : "Sem saldo no histórico: informe o preço.",
                  }
                : x,
            ),
          },
      );
    } catch {
      /* segue digitado */
    }
  }

  async function nomeFazenda(i, cod) {
    if (!form || !cod.trim()) return;
    try {
      const res = await fetch(`/api/rodadas/apontamento?cad=fazendas&cod=${encodeURIComponent(cod.trim())}`, { cache: "no-store" });
      const json = await res.json();
      const nm = json?.item?.nm;
      if (nm) setForm((f) => f && { ...f, faz: f.faz.map((x, k) => (k === i && !x.nome ? { ...x, nome: nm } : x)) });
    } catch {
      /* o nome pode ser digitado */
    }
  }

  const upd = (patch) => setForm((f) => (f ? { ...f, ...patch } : f));
  const updItem = (i, patch) => setForm((f) => f && { ...f, itens: f.itens.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  const updFaz = (i, patch) => setForm((f) => f && { ...f, faz: f.faz.map((x, k) => (k === i ? { ...x, ...patch } : x)) });
  const totalForm = form ? form.itens.reduce((a, i) => a + (numero(i.qtd) > 0 ? totalItem(numero(i.qtd), numero(i.vu || "0") || 0) : 0), 0) : 0;
  // algo digitado ou alterado desde que a janela abriu
  const alterado = form ? conteudoForm(form) !== origem : false;

  return (
    <Pagina translate="no">
      <CabecalhoPagina
        titulo="Empréstimos"
        categoria="Acompanhamentos · Insumos"
        comandos={
          <>
            {podeGravar && (
              <Comando primario icone={<IconMais size={16} />} onClick={novoEmprestimo} title="Novo empréstimo (F2)">
                Novo empréstimo
              </Comando>
            )}
            <Comando
              icone={<IconImprimir size={16} />}
              onClick={() => {
                setErroRelatorio(null);
                setJanelaRelatorio(true);
              }}
              disabled={carregando || filtrada.length === 0}
              title="Relatório em PDF dos empréstimos da lista (com os filtros da tela): sintético ou analítico"
            >
              Gerar relatório
            </Comando>
          </>
        }
      />

      <CorpoPagina>
        {msg && !form && (
          <div className="mb-3">
            <Aviso msg={msg} onFechar={() => setMsg(null)} />
          </div>
        )}

        <JanelaFormulario
          aberto={!!form}
          rotulo={form?.id ? "Editar empréstimo" : "Novo empréstimo"}
          titulo={form?.id ? `Editando a Solicitação nº ${form.solicitacao ?? `#${form.id}`}` : "Novo empréstimo"}
          subtitulo="Solicitação de empréstimo de insumos a fornecedor · F2 grava · Esc fecha"
          aviso={msg && <Aviso msg={msg} onFechar={() => setMsg(null)} />}
          onFechar={fecharForm}
          onGravar={salvar}
          ocupado={salvando}
          corpoRef={formRef}
          focoInicial={fornRef}
          topoDireita={
            form && (
              // nº da Solicitação: do sistema (ANO + MÊS + sequência no mês); no novo, a prévia do próximo do mês
              <div
                className="campo-boletim"
                title={
                  form.id && !precisaPrevia
                    ? "Gerado pelo sistema: ano + mês da solicitação + sequência no mês."
                    : form.id
                      ? "A data foi para outro mês: ao gravar, a Solicitação ganha o próximo nº do mês novo."
                      : "Gerado ao gravar: ano + mês da solicitação + sequência no mês (este é o próximo livre agora)."
                }
              >
                Solicitação nº
                <span className={`px-1 py-0.5 text-[15px] font-semibold tabular ${precisaPrevia ? "text-muted" : "text-ink"}`}>
                  {precisaPrevia ? (previa ?? "…") : (form.solicitacao ?? "—")}
                </span>
                {precisaPrevia && <span className="pr-1 text-[10.5px] text-muted">{form.id ? "novo nº" : "ao gravar"}</span>}
              </div>
            )
          }
          rodape={
            form && (
              <>
                <button type="button" className={BOTAO} onClick={fecharForm}>
                  {form.id ? "Cancelar edição" : "Fechar"}
                </button>
                {!form.id && alterado && (
                  <button
                    type="button"
                    className={BOTAO}
                    onClick={() => {
                      setMsg((m) => (m?.erro ? null : m));
                      limparForm();
                      irAoTopo(true);
                    }}
                  >
                    Limpar
                  </button>
                )}
                <button
                  type="button"
                  disabled={salvando}
                  onClick={salvar}
                  className="rounded-lg bg-navy-900 px-5 py-2 text-[13px] font-medium text-white hover:bg-navy-800 disabled:opacity-40"
                >
                  {salvando ? "Gravando…" : form.id ? "Salvar alteração (F2)" : "Lançar empréstimo (F2)"}
                </button>
              </>
            )
          }
        >
          {form && (
            <>
              <datalist id="forn-cods">
                {Array.from(sugestoesForn.entries()).map(([c, v]) => (
                  <option key={c} value={c}>
                    {v.nm}
                  </option>
                ))}
              </datalist>
              <datalist id="item-sug">
                {sugestoes.map((x) => (
                  <option key={x.cod} value={x.cod}>
                    {x.ds} ({x.un})
                  </option>
                ))}
              </datalist>

              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <div>
                  <label className={ROTULO}>Data solicitação</label>
                  <input type="date" value={form.dtSol} onChange={(e) => upd({ dtSol: e.target.value })} className={INPUT} />
                </div>
                <div>
                  <label className={ROTULO}>Data saída (comunicado)</label>
                  <input type="date" value={form.dt} onChange={(e) => upd({ dt: e.target.value })} className={INPUT} />
                </div>
                <div>
                  <label className={ROTULO}>Matrícula/Fornecedor</label>
                  <input
                    ref={fornRef}
                    list="forn-cods"
                    value={form.fornCod}
                    onChange={(e) => {
                      const v = e.target.value;
                      const s = sugestoesForn.get(v);
                      upd(s ? { fornCod: v, fornNm: s.nm, doc: s.doc } : { fornCod: v });
                    }}
                    className={INPUT}
                  />
                </div>
                <div>
                  <label className={ROTULO}>CPF / CNPJ</label>
                  <input value={form.doc} onChange={(e) => upd({ doc: e.target.value })} className={INPUT} />
                </div>
                <div className="col-span-2 md:col-span-4">
                  <label className={ROTULO}>Destinatário (nome)</label>
                  <input value={form.fornNm} onChange={(e) => upd({ fornNm: e.target.value })} className={INPUT} />
                </div>
              </div>

              <div className="caixa-form-sub">Insumos emprestados</div>
              <div className="overflow-x-auto rounded-lg border border-line bg-card">
                <table className="w-full min-w-[760px] text-[12.5px]" data-sem-ordenar>
                  <thead>
                    <tr className="bg-surface text-left text-muted">
                      <th className="w-[130px] px-2 py-1.5 font-semibold">Código</th>
                      <th className="px-2 py-1.5 font-semibold">Descrição</th>
                      <th className="w-[70px] px-2 py-1.5 font-semibold">U.M.</th>
                      <th className="w-[80px] px-2 py-1.5 text-right font-semibold">Dose</th>
                      <th className="w-[100px] px-2 py-1.5 text-right font-semibold">Qtd</th>
                      <th className="w-[110px] px-2 py-1.5 text-right font-semibold">Preço médio</th>
                      <th className="w-[120px] px-2 py-1.5 text-right font-semibold">Vl. total</th>
                      <th className="w-[30px]" />
                    </tr>
                  </thead>
                  <tbody>
                    {form.itens.map((i, k) => {
                      const cel =
                        "w-full rounded border border-transparent bg-transparent px-1.5 py-1 hover:border-line focus:border-navy-900 focus:bg-surface focus:outline-none";
                      return (
                        <Fragment key={k}>
                          <tr className="border-t border-line/60 align-middle">
                            <td className="px-1 py-0.5">
                              <input
                                list="item-sug"
                                value={i.cod}
                                onChange={(e) => {
                                  const v = e.target.value;
                                  updItem(k, { cod: v, cad: undefined, aviso: undefined, doBanco: undefined });
                                  buscarSugestoes(v);
                                  if (sugestoes.some((x) => x.cod === v)) aplicarItem(k, v);
                                }}
                                // a linha gravada com o código intacto (só passou o Tab) fica com a descrição, a UM e o preço dela
                                onBlur={() => i.cad === undefined && !i.doBanco && aplicarItem(k, i.cod)}
                                className={`${cel} tabular`}
                                aria-label="Código do insumo"
                              />
                            </td>
                            <td className="px-1 py-0.5">
                              <input
                                value={i.nm}
                                readOnly={i.cad === true}
                                onChange={(e) => updItem(k, { nm: e.target.value })}
                                className={cel}
                                aria-label="Descrição"
                              />
                            </td>
                            <td className="px-1 py-0.5">
                              <input
                                value={i.um}
                                readOnly={i.cad === true}
                                onChange={(e) => updItem(k, { um: e.target.value })}
                                className={cel}
                                aria-label="Unidade"
                              />
                            </td>
                            <td className="px-1 py-0.5">
                              <input
                                value={i.dose}
                                onChange={(e) => updItem(k, { dose: e.target.value })}
                                inputMode="decimal"
                                className={`${cel} text-right`}
                                aria-label="Dose"
                              />
                            </td>
                            <td className="px-1 py-0.5">
                              <input
                                value={i.qtd}
                                onChange={(e) => updItem(k, { qtd: e.target.value })}
                                inputMode="decimal"
                                className={`${cel} text-right`}
                                aria-label="Quantidade"
                              />
                            </td>
                            <td className="px-1 py-0.5">
                              <input
                                value={i.vu}
                                onChange={(e) => updItem(k, { vu: e.target.value })}
                                inputMode="decimal"
                                className={`${cel} text-right`}
                                aria-label="Preço médio"
                              />
                            </td>
                            <td className="px-2 py-0.5 text-right tabular font-semibold">
                              {brl(numero(i.qtd) > 0 ? totalItem(numero(i.qtd), numero(i.vu || "0") || 0) : 0)}
                            </td>
                            <td className="px-1 text-center">
                              {form.itens.length > 1 && (
                                <button
                                  type="button"
                                  title="Remover linha"
                                  onClick={() => upd({ itens: form.itens.filter((_, x) => x !== k) })}
                                  className="text-alert-700 hover:underline"
                                >
                                  ×
                                </button>
                              )}
                            </td>
                          </tr>
                          {i.aviso && (
                            <tr>
                              <td />
                              <td colSpan={7} className={`px-2 pb-1 text-[11px] ${i.cad === false ? "text-amber-700" : "text-muted"}`}>
                                {i.aviso}
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                    <tr className="border-t border-line bg-surface font-bold">
                      <td colSpan={6} className="px-2 py-1.5 text-right">
                        Total
                      </td>
                      <td className="px-2 py-1.5 text-right tabular">{brl(totalForm)}</td>
                      <td />
                    </tr>
                  </tbody>
                </table>
              </div>
              <button type="button" className={`${BOTAO} mt-2`} onClick={() => upd({ itens: [...form.itens, itemVazio()] })}>
                + Insumo
              </button>

              <div className="caixa-form-sub">Local de aplicação</div>
              <div className="overflow-x-auto rounded-lg border border-line bg-card">
                <table className="w-full min-w-[520px] text-[12.5px]" data-sem-ordenar>
                  <thead>
                    <tr className="bg-surface text-left text-muted">
                      <th className="w-[130px] px-2 py-1.5 font-semibold">Fazenda</th>
                      <th className="px-2 py-1.5 font-semibold">Descrição Fazenda</th>
                      <th className="w-[130px] px-2 py-1.5 text-right font-semibold">Área (ha)</th>
                      <th className="w-[30px]" />
                    </tr>
                  </thead>
                  <tbody>
                    {form.faz.map((f, k) => {
                      const cel =
                        "w-full rounded border border-transparent bg-transparent px-1.5 py-1 hover:border-line focus:border-navy-900 focus:bg-surface focus:outline-none";
                      return (
                        <tr key={k} className="border-t border-line/60">
                          <td className="px-1 py-0.5">
                            <input
                              value={f.cod}
                              onChange={(e) => updFaz(k, { cod: e.target.value })}
                              onBlur={() => nomeFazenda(k, f.cod)}
                              className={`${cel} tabular`}
                              aria-label="Código da fazenda"
                            />
                          </td>
                          <td className="px-1 py-0.5">
                            <input value={f.nome} onChange={(e) => updFaz(k, { nome: e.target.value })} className={cel} aria-label="Descrição da fazenda" />
                          </td>
                          <td className="px-1 py-0.5">
                            <input
                              value={f.area}
                              onChange={(e) => updFaz(k, { area: e.target.value })}
                              inputMode="decimal"
                              className={`${cel} text-right`}
                              aria-label="Área"
                            />
                          </td>
                          <td className="px-1 text-center">
                            {form.faz.length > 1 && (
                              <button
                                type="button"
                                title="Remover linha"
                                onClick={() => upd({ faz: form.faz.filter((_, x) => x !== k) })}
                                className="text-alert-700 hover:underline"
                              >
                                ×
                              </button>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <button type="button" className={`${BOTAO} mt-2`} onClick={() => upd({ faz: [...form.faz, fazVazia()] })}>
                + Fazenda
              </button>

              <div className="caixa-form-sub">Volume, assinaturas e observação</div>
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div>
                  <label className={ROTULO}>Volume de</label>
                  <select value={form.volTipo} onChange={(e) => upd({ volTipo: e.target.value })} className={INPUT}>
                    <option value="Calda">Calda</option>
                    <option value="Insumo">Insumo</option>
                  </select>
                </div>
                <div className="md:col-span-2">
                  <label className={ROTULO}>Volume (ex.: 18.800 lt · 58 ton)</label>
                  <input value={form.vol} onChange={(e) => upd({ vol: e.target.value })} className={INPUT} />
                </div>
                <div className="md:col-span-3">
                  <label className={ROTULO}>Assinaturas do comunicado (um nome por linha)</label>
                  <textarea value={form.assin.join("\n")} onChange={(e) => upd({ assin: e.target.value.split("\n") })} rows={3} className={INPUT} />
                </div>
                <div className="md:col-span-3">
                  <label className={ROTULO}>Observação</label>
                  <input value={form.obs} onChange={(e) => upd({ obs: e.target.value })} className={INPUT} />
                </div>
              </div>
            </>
          )}
        </JanelaFormulario>

        {/* cada card abre a janela com os empréstimos que formam o valor; o filtro da lista pela situação (que o clique
            no card fazia antes) fica no rodapé da janela. O contorno continua marcando a situação filtrada na lista. */}
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {["Aberto", "Devolvido", "Pago"].map((s) => (
            <BotaoCartao key={s} onClick={() => setJanela(s)} className={filtroStatus === s ? "ring-2 ring-navy-900 dark:ring-crv-acao" : ""}>
              <Indicador cor={COR_RESUMO[s]} rotulo={NOME_RESUMO[s]} valor={brl(resumo[s].valor)} apoio={`${resumo[s].n} empréstimo(s)`} className="h-full" />
            </BotaoCartao>
          ))}
        </div>

        <BarraFiltros>
          <div className="min-w-[220px] flex-1">
            <label className={ROTULO}>Buscar</label>
            <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Fornecedor, fazenda, insumo ou nº" className={INPUT} />
          </div>
          <div>
            <label className={ROTULO}>Situação</label>
            <select value={filtroStatus} onChange={(e) => setFiltroStatus(e.target.value)} className={`${INPUT} min-w-[150px]`}>
              <option value="">Todas</option>
              <option value="Aberto">Em aberto</option>
              <option value="Devolvido">Devolvido</option>
              <option value="Pago">Pago</option>
            </select>
          </div>
          <BotaoLimparFiltros ativo={algumFiltroAtivo} onLimpar={limparFiltros} />
        </BarraFiltros>

        {erro && <p className="mb-3 rounded-md border border-alert-500/40 bg-alert-50 px-3 py-2 text-[13px] text-alert-700">{erro}</p>}

        <div className="overflow-x-auto rounded-xl2 border border-line bg-card shadow-card">
          <table className="w-full min-w-[900px] text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-surface text-left text-muted">
                <th className="px-3 py-2 font-semibold">Solicitação</th>
                <th className="px-3 py-2 font-semibold">Data Solicitação</th>
                <th className="px-3 py-2 font-semibold">Data Saída</th>
                <th className="px-3 py-2 font-semibold">Fornecedor</th>
                <th className="px-3 py-2 font-semibold">Fazenda</th>
                <th className="px-3 py-2 font-semibold">Descrição Fazenda</th>
                <th className="px-3 py-2 font-semibold">Insumos</th>
                <th className="px-3 py-2 text-right font-semibold">Valor total</th>
                <th className="px-3 py-2 font-semibold">Situação</th>
              </tr>
            </thead>
            <tbody>
              {carregando && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-muted">
                    Carregando…
                  </td>
                </tr>
              )}
              {!carregando && filtrada.length === 0 && (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-muted">
                    Nenhum empréstimo encontrado.
                  </td>
                </tr>
              )}
              {filtrada.map((e) => (
                <Fragment key={e.id}>
                  <tr
                    id={`emprestimo-${e.id}`}
                    data-linha={e.id}
                    className="cursor-pointer border-b border-line hover:bg-surface/60"
                    onClick={() => setAberto(aberto === e.id ? null : e.id)}
                  >
                    <td className="px-3 py-2 tabular font-medium text-ink">{e.solicitacao ?? <span className="text-muted">#{e.id}</span>}</td>
                    <td className="px-3 py-2 tabular">{e.dtSol ? fmtDateBR(e.dtSol) : <span className="text-muted/60">—</span>}</td>
                    <td className="px-3 py-2 tabular">{e.dt ? fmtDateBR(e.dt) : <span className="text-muted/60">—</span>}</td>
                    <td className="px-3 py-2 font-semibold text-ink">
                      {e.fornNm}
                      <div className="text-[11px] font-normal text-muted">{e.fornCod}</div>
                    </td>
                    <td className="px-3 py-2 tabular">{e.faz.map((f) => f.cod).join(" / ")}</td>
                    <td className="px-3 py-2">
                      {e.faz
                        .map((f) => f.nome)
                        .filter(Boolean)
                        .join(" / ")}
                    </td>
                    <td className="max-w-[260px] truncate px-3 py-2 text-muted">{e.itens.map((i) => i.nm).join(", ")}</td>
                    <td className="px-3 py-2 text-right tabular font-semibold">{brl(e.total)}</td>
                    <td className="px-3 py-2">
                      <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${COR_STATUS[e.status]}`}>
                        {e.status === "Aberto" ? "Em aberto" : e.status}
                      </span>
                      {e.dtBaixa && <div className="text-[11px] text-muted">em {fmtDateBR(e.dtBaixa)}</div>}
                    </td>
                  </tr>
                  {aberto === e.id && (
                    // acompanha a linha dela quando a tabela é ordenada pelo título de uma coluna (OrdenarTabelas)
                    <tr data-detalhe-de={e.id} className="border-b border-line bg-surface/40">
                      <td colSpan={9} className="px-4 py-3">
                        <table className="mb-3 w-full max-w-[860px] text-[12px]">
                          <thead>
                            <tr className="text-left text-muted">
                              <th className="py-1 pr-3 font-semibold">Código</th>
                              <th className="py-1 pr-3 font-semibold">Descrição</th>
                              <th className="py-1 pr-3 font-semibold">U.M.</th>
                              <th className="py-1 pr-3 text-right font-semibold">Dose</th>
                              <th className="py-1 pr-3 text-right font-semibold">Qtd</th>
                              <th className="py-1 pr-3 text-right font-semibold">Vl. unit.</th>
                              <th className="py-1 text-right font-semibold">Vl. total</th>
                            </tr>
                          </thead>
                          <tbody>
                            {e.itens.map((i, k) => (
                              <tr key={k} className="border-t border-line/60">
                                <td className="py-1 pr-3 tabular">{i.cod}</td>
                                <td className="py-1 pr-3">{i.nm}</td>
                                <td className="py-1 pr-3">{i.um}</td>
                                <td className="py-1 pr-3 text-right tabular">{i.dose !== null ? qt(i.dose) : ""}</td>
                                <td className="py-1 pr-3 text-right tabular">{qt(i.qtd)}</td>
                                <td className="py-1 pr-3 text-right tabular">
                                  {i.vu.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                                </td>
                                <td className="py-1 text-right tabular">{brl(i.vt)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                        <div className="mb-3 grid gap-x-8 gap-y-0.5 text-[12px] text-muted sm:grid-cols-2">
                          <div>
                            Destinatário: {e.fornCod} – {e.fornNm}
                            {e.doc ? ` · ${e.doc}` : ""}
                          </div>
                          <div>
                            Volume de {e.volTipo}: {e.vol || "—"}
                          </div>
                          <div>Área: {e.faz.map((f) => `${f.cod}: ${f.area !== null ? `${f.area.toLocaleString("pt-BR")} ha` : "—"}`).join(" · ")}</div>
                          <div>
                            Lançado por {e.usr} em {fmtDateBR(e.criEm.slice(0, 10))}
                            {e.atuUsr ? ` · alterado por ${e.atuUsr} em ${fmtDateBR((e.atuEm ?? "").slice(0, 10))}` : ""}
                          </div>
                          {e.baixaObs && <div className="sm:col-span-2">Baixa: {e.baixaObs}</div>}
                          {e.obs && <div className="sm:col-span-2">Obs.: {e.obs}</div>}
                          {e.ref && <div className="sm:col-span-2">Origem: {e.ref}</div>}
                          {e.boletim && <div className="sm:col-span-2">Boletim anterior (antes da Solicitação automática): {e.boletim}</div>}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" className={BOTAO} onClick={() => gerarComunicadoEmprestimoPdf(e)}>
                            Gerar comunicado (PDF)
                          </button>
                          {podeGravar && (
                            <>
                              <button type="button" className={BOTAO} onClick={() => editar(e)}>
                                Editar
                              </button>
                              {e.status === "Aberto" ? (
                                <button
                                  type="button"
                                  className={BOTAO}
                                  onClick={() => {
                                    setErroModal(null);
                                    setBaixa({ e, tipo: "Devolvido", data: todayISO(), obs: "" });
                                  }}
                                >
                                  Dar baixa (devolvido / pago)
                                </button>
                              ) : (
                                <button type="button" className={BOTAO} onClick={() => reabrir(e)}>
                                  Reabrir
                                </button>
                              )}
                              <button type="button" className={`${BOTAO} text-alert-700`} onClick={() => excluir(e)}>
                                Excluir
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </CorpoPagina>

      {janela && (
        <JanelaSituacao
          status={janela}
          emprestimos={lista.filter((e) => e.status === janela)}
          resumo={resumo[janela]}
          onVer={verNaLista}
          onFechar={() => setJanela(null)}
          rodape={
            <>
              <span className="mr-auto text-[11.5px] text-muted">
                {filtroStatus
                  ? `A lista ${filtroStatus === janela ? "já " : ""}mostra só os ${NOME_RESUMO[filtroStatus].toLowerCase()}.`
                  : "A lista mostra todas as situações."}
              </span>
              <button
                type="button"
                className={BOTAO}
                onClick={() => {
                  setFiltroStatus(filtroStatus === janela ? "" : janela);
                  setJanela(null);
                }}
              >
                {filtroStatus === janela ? "Mostrar todas as situações na lista" : `Mostrar só os ${NOME_RESUMO[janela].toLowerCase()} na lista`}
              </button>
            </>
          }
        />
      )}

      {baixa && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div role="dialog" aria-modal="true" aria-label="Dar baixa no empréstimo" className="w-full max-w-md rounded-xl2 bg-card p-5 shadow-card">
            <h2 className="text-[15px] font-bold text-ink">
              Dar baixa — Solicitação nº {nSolicitacao(baixa.e)} · {baixa.e.fornNm}
            </h2>
            <p className="mt-1 text-[12px] text-muted">
              {brl(baixa.e.total)} · {baixa.e.faz.map((f) => f.cod).join(" / ")}
            </p>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <div>
                <label className={ROTULO}>Baixa por</label>
                <select value={baixa.tipo} onChange={(ev) => setBaixa({ ...baixa, tipo: ev.target.value })} className={INPUT}>
                  <option value="Devolvido">Devolução do insumo</option>
                  <option value="Pago">Pagamento</option>
                </select>
              </div>
              <div>
                <label className={ROTULO}>Data da baixa</label>
                <input type="date" value={baixa.data} onChange={(ev) => setBaixa({ ...baixa, data: ev.target.value })} className={INPUT} />
              </div>
              <div className="col-span-2">
                <label className={ROTULO}>Observação (NF, recibo, etc.)</label>
                <input value={baixa.obs} onChange={(ev) => setBaixa({ ...baixa, obs: ev.target.value })} className={INPUT} />
              </div>
            </div>
            {erroModal && <p className="mt-3 text-[12.5px] text-alert-700">{erroModal}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={BOTAO} onClick={() => setBaixa(null)} title="Cancelar (Esc)">
                Cancelar
              </button>
              <button
                type="button"
                disabled={salvando}
                onClick={confirmarBaixa}
                className="rounded-lg bg-navy-900 px-4 py-1.5 text-[12.5px] font-semibold text-white disabled:opacity-50"
              >
                {salvando ? "Gravando…" : "Confirmar baixa"}
              </button>
            </div>
          </div>
        </div>
      )}

      {janelaRelatorio && (
        <JanelaInfo
          titulo="Gerar relatório"
          subtitulo={`${filtrada.length} empréstimo(s) da lista · ${filtrosTexto}`}
          largura="lg"
          onFechar={() => !gerandoRelatorio && setJanelaRelatorio(false)}
          rodape={
            <>
              <button type="button" className={BOTAO} onClick={() => setJanelaRelatorio(false)} disabled={gerandoRelatorio}>
                Cancelar
              </button>
              <button
                type="button"
                onClick={gerarRelatorio}
                disabled={gerandoRelatorio || filtrada.length === 0}
                className="inline-flex items-center gap-1.5 rounded-lg bg-navy-900 px-4 py-1.5 text-[12.5px] font-semibold text-white hover:bg-navy-800 disabled:opacity-50"
              >
                <IconImprimir size={15} />
                {gerandoRelatorio ? "Gerando…" : "Gerar PDF"}
              </button>
            </>
          }
        >
          <fieldset className="space-y-2">
            <legend className="mb-1 text-[12.5px] font-semibold text-ink">Tipo do relatório</legend>
            {TIPOS_RELATORIO.map((o) => (
              <label
                key={o.v}
                className={`flex cursor-pointer items-start gap-3 rounded-lg border px-3 py-2.5 ${
                  relatorio === o.v ? "border-navy-900 bg-[#2E5FA8]/[0.06] dark:border-crv-acao" : "border-line hover:bg-surface"
                }`}
              >
                <input
                  type="radio"
                  name="emp-relatorio"
                  value={o.v}
                  checked={relatorio === o.v}
                  onChange={() => setRelatorio(o.v)}
                  className="mt-1 h-4 w-4 flex-shrink-0 accent-[#23396B] dark:accent-[#7FA8E8]"
                />
                <span>
                  <span className="block text-[13.5px] font-semibold text-ink">{o.t}</span>
                  <span className="block text-[12px] leading-snug text-muted">{o.d}</span>
                </span>
              </label>
            ))}
          </fieldset>
          <p className="mt-3 text-[12px] text-muted">Entram os empréstimos da lista como estão na tela: a situação e a busca escolhidas valem para o relatório.</p>
          {erroRelatorio && <p className="mt-3 rounded-md border border-alert-500/40 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-700">{erroRelatorio}</p>}
        </JanelaInfo>
      )}

      {confirmar && (
        <JanelaConfirmar
          {...confirmar}
          onCancelar={() => setConfirmar(null)}
          onConfirmar={() => {
            const acao = confirmar.acao;
            setConfirmar(null);
            acao();
          }}
        />
      )}
    </Pagina>
  );
}

/* ---------- Janela dos cards: os empréstimos da situação que formam o valor (todos os lançados, sem a busca da lista) ---------- */

/** Dias corridos de `iso` até `hoje` (as duas em AAAA-MM-DD); sem data, nada. */
const diasDesde = (iso, hoje) => (iso ? Math.round((Date.parse(hoje) - Date.parse(iso)) / 86400000) : null);

const NOTA_SITUACAO = {
  Aberto: "Empréstimos ainda sem baixa (nem devolução do insumo nem pagamento). Dias = desde a data de saída ou, sem ela, desde a solicitação.",
  Devolvido: "Empréstimos baixados por devolução do insumo.",
  Pago: "Empréstimos baixados por pagamento.",
};

/** Card de uma situação: os empréstimos que formam o valor e, abaixo, os mesmos valores por insumo e por fornecedor. */
function JanelaSituacao({ status, emprestimos, resumo, onVer, onFechar, rodape }) {
  const hoje = todayISO();
  const porInsumo = useMemo(() => {
    const m = new Map();
    for (const e of emprestimos) {
      for (const i of e.itens) {
        const k = `${i.cod}|${i.um}`;
        const x = m.get(k) ?? { cod: i.cod, nm: i.nm, um: i.um, qtd: 0, vt: 0, ids: new Set() };
        x.qtd += i.qtd ?? 0;
        x.vt += i.vt ?? 0;
        x.ids.add(e.id);
        m.set(k, x);
      }
    }
    return Array.from(m.values())
      .map((x) => ({ ...x, n: x.ids.size }))
      .sort((a, b) => b.vt - a.vt);
  }, [emprestimos]);
  const porFornecedor = useMemo(() => {
    const m = new Map();
    for (const e of emprestimos) {
      const k = `${e.fornCod}|${e.fornNm}`;
      const x = m.get(k) ?? { fornCod: e.fornCod, fornNm: e.fornNm, n: 0, valor: 0 };
      x.n += 1;
      x.valor += e.total;
      m.set(k, x);
    }
    return Array.from(m.values()).sort((a, b) => b.valor - a.valor);
  }, [emprestimos]);
  const somaInsumos = porInsumo.reduce((s, x) => s + x.vt, 0);
  const nome = NOME_RESUMO[status];

  const colunas = [
    {
      rotulo: "Solicitação",
      valor: (e) => nSolicitacao(e),
      exibir: (e) => (
        <BotaoLink onClick={() => onVer(e)} title="Ver o empréstimo aberto na lista">
          {nSolicitacao(e)}
        </BotaoLink>
      ),
    },
    { rotulo: "Data Solicitação", valor: (e) => (e.dtSol ? fmtDateBR(e.dtSol) : ""), classe: () => "whitespace-nowrap tabular text-ink" },
    { rotulo: "Data Saída", valor: (e) => (e.dt ? fmtDateBR(e.dt) : ""), classe: () => "whitespace-nowrap tabular text-ink" },
    status === "Aberto"
      ? { rotulo: "Dias", num: "int", valor: (e) => diasDesde(e.dt || e.dtSol, hoje), classe: () => "text-muted" }
      : { rotulo: "Data Baixa", valor: (e) => (e.dtBaixa ? fmtDateBR(e.dtBaixa) : ""), classe: () => "whitespace-nowrap tabular text-ink" },
    { rotulo: "Fornecedor", valor: (e) => e.fornNm, classe: () => "font-medium text-ink" },
    { rotulo: "Matrícula", valor: (e) => e.fornCod, classe: () => "text-muted" },
    { rotulo: "Fazenda", valor: (e) => e.faz.map((f) => f.cod).join(" / "), classe: () => "tabular text-ink" },
    {
      rotulo: "Insumos",
      valor: (e) => e.itens.map((i) => i.nm).join(", "),
      classe: () => "max-w-[260px] truncate text-muted",
      dica: (e) => e.itens.map((i) => i.nm).join(", "),
    },
    { rotulo: "Valor total (R$)", num: "dec", valor: (e) => e.total, total: resumo.valor, classe: () => "font-medium text-ink" },
  ];
  const colunasInsumo = [
    { rotulo: "Código", valor: (x) => x.cod, classe: () => "tabular text-muted" },
    { rotulo: "Descrição", valor: (x) => x.nm },
    { rotulo: "U.M.", valor: (x) => x.um, classe: () => "text-muted" },
    { rotulo: "Empréstimos", num: "int", valor: (x) => x.n },
    { rotulo: "Qtd", num: "qtd", valor: (x) => x.qtd },
    { rotulo: "Vl. total (R$)", num: "dec", valor: (x) => x.vt, total: somaInsumos },
  ];
  const colunasFornecedor = [
    { rotulo: "Matrícula", valor: (x) => x.fornCod, classe: () => "text-muted" },
    { rotulo: "Fornecedor", valor: (x) => x.fornNm, classe: () => "font-medium text-ink" },
    { rotulo: "Empréstimos", num: "int", valor: (x) => x.n, total: resumo.n },
    { rotulo: "Valor total (R$)", num: "dec", valor: (x) => x.valor, total: resumo.valor },
  ];
  return (
    <JanelaCard
      titulo={`Empréstimos · ${nome.toLowerCase()}`}
      subtitulo={`${int(resumo.n)} empréstimo(s) · todos os lançados, sem a busca da lista`}
      prefixo="Empréstimos"
      onFechar={onFechar}
      largura="6xl"
      exportar={{ nome, colunas, linhas: emprestimos }}
      rodape={rodape}
    >
      <Nota>{NOTA_SITUACAO[status]} Clique na solicitação para ver o empréstimo aberto na lista.</Nota>
      <TabelaJanela
        colunas={colunas}
        linhas={emprestimos}
        chave={(e) => e.id}
        vazio="Nenhum empréstimo nesta situação."
        rotuloTotal={`Total · ${int(resumo.n)} empréstimo(s)`}
      />
      <Secao
        titulo={`Por insumo · ${int(porInsumo.length)}`}
        acoes={exportarTabela("Empréstimos", { nome: `${nome} por insumo`, colunas: colunasInsumo, linhas: porInsumo })}
      >
        <TabelaJanela colunas={colunasInsumo} linhas={porInsumo} chave={(x) => `${x.cod}|${x.um}`} vazio="Nenhum insumo nesta situação." />
      </Secao>
      <Secao
        titulo={`Por fornecedor · ${int(porFornecedor.length)}`}
        acoes={exportarTabela("Empréstimos", { nome: `${nome} por fornecedor`, colunas: colunasFornecedor, linhas: porFornecedor })}
      >
        <TabelaJanela
          colunas={colunasFornecedor}
          linhas={porFornecedor}
          chave={(x) => `${x.fornCod}|${x.fornNm}`}
          vazio="Nenhum fornecedor nesta situação."
          rotuloTotal={`Total · ${int(porFornecedor.length)} fornecedor(es)`}
        />
      </Secao>
    </JanelaCard>
  );
}
