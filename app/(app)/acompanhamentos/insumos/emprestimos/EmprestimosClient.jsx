"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import BotaoLog from "@/components/BotaoLog";
import { IconMais } from "@/components/icons";
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

const numero = (v) => (v.includes(",") ? Number(v.replace(/\./g, "").replace(",", ".")) : Number(v));
const emTexto = (n) => (n === null || n === undefined ? "" : String(n).replace(".", ","));

const itemVazio = () => ({ cod: "", nm: "", um: "", dose: "", qtd: "", vu: "" });
const fazVazia = () => ({ cod: "", nome: "", area: "" });

function formVazio() {
  return {
    boletim: "",
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
    boletim: e.boletim ? String(e.boletim) : "",
    fornCod: e.fornCod,
    fornNm: e.fornNm,
    doc: e.doc,
    dtSol: e.dtSol ?? "",
    dt: e.dt ?? "",
    faz: e.faz.map((f) => ({ cod: f.cod, nome: f.nome, area: emTexto(f.area) })),
    volTipo: e.volTipo,
    vol: e.vol,
    assin: [...e.assin],
    itens: e.itens.map((i) => ({ cod: i.cod, nm: i.nm, um: i.um, dose: emTexto(i.dose), qtd: emTexto(i.qtd), vu: emTexto(i.vu) })),
    obs: e.obs,
  };
}

export default function EmprestimosClient({ perfil }) {
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
  const [form, setForm] = useState(null);
  const [baixa, setBaixa] = useState(null);
  const [salvando, setSalvando] = useState(false);
  const [erroModal, setErroModal] = useState(null);

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

  const filtrada = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return lista.filter((e) => {
      if (filtroStatus && e.status !== filtroStatus) return false;
      if (!q) return true;
      return [e.fornNm, e.fornCod, ...e.faz.map((f) => `${f.cod} ${f.nome}`), ...e.itens.map((i) => `${i.cod} ${i.nm}`), String(e.id)]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [lista, filtroStatus, busca]);

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

  function irParaFormulario() {
    setTimeout(() => document.getElementById("form-emprestimo")?.scrollIntoView({ behavior: "smooth", block: "start" }), 60);
  }

  async function novoEmprestimo() {
    setErroModal(null);
    setForm(formVazio());
    irParaFormulario();
    try {
      const res = await fetch("/api/emprestimos?proximo=1", { cache: "no-store" });
      const json = await res.json();
      if (res.ok) setForm((f) => (f && !f.id && !f.boletim ? { ...f, boletim: String(json.boletim) } : f));
    } catch {
      /* digita à mão */
    }
  }

  async function salvar() {
    if (!form) return;
    setSalvando(true);
    setErroModal(null);
    try {
      await chamar("POST", {
        id: form.id,
        boletim: form.boletim ? Number(form.boletim) : null,
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
      setForm(null);
      await carregar();
    } catch (e) {
      setErroModal(e instanceof Error ? e.message : "Não foi possível salvar.");
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

  async function reabrir(e) {
    if (!window.confirm(`Reabrir o empréstimo #${e.id} (${e.fornNm})? A baixa será desfeita.`)) return;
    try {
      await chamar("POST", { acao: "baixa", id: e.id, tipo: "Aberto" });
      await carregar();
    } catch (er) {
      setErro(er instanceof Error ? er.message : "Não foi possível reabrir.");
    }
  }

  async function excluir(e) {
    if (!window.confirm(`Excluir o empréstimo #${e.id} (${e.fornNm})? A exclusão fica registrada no log.`)) return;
    try {
      await chamar("DELETE", { id: e.id });
      setAberto(null);
      await carregar();
    } catch (er) {
      setErro(er instanceof Error ? er.message : "Não foi possível excluir.");
    }
  }

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

  return (
    <Pagina translate="no">
      <CabecalhoPagina
        titulo="Empréstimos"
        categoria="Acompanhamentos · Insumos"
        comandos={
          <>
            {podeGravar && (
              <Comando primario icone={<IconMais size={16} />} onClick={novoEmprestimo}>
                Novo empréstimo
              </Comando>
            )}
            <BotaoLog titulo="Log de Empréstimos de Insumos" filtro={{ modulo: "Insumos" }} />
          </>
        }
      />

      <CorpoPagina>
        {form && (
          <section id="form-emprestimo" className="caixa-form mb-5 scroll-mt-4">
            <div className="caixa-form-topo">
              <div>
                <h2 className="caixa-form-titulo">{form.id ? "Editando o empréstimo" : "Novo empréstimo"}</h2>
                <div className="text-[11.5px] text-muted">Solicitação de empréstimo de insumos a fornecedor</div>
              </div>
              <label className="campo-boletim">
                Boletim nº
                <input
                  value={form.boletim}
                  onChange={(e) => upd({ boletim: e.target.value.replace(/\D/g, "").slice(0, 9) })}
                  inputMode="numeric"
                  aria-label="Número do boletim"
                />
              </label>
            </div>
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
              <table className="w-full min-w-[760px] text-[12.5px]">
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
                                updItem(k, { cod: v, cad: undefined, aviso: undefined });
                                buscarSugestoes(v);
                                if (sugestoes.some((x) => x.cod === v)) aplicarItem(k, v);
                              }}
                              onBlur={() => i.cad === undefined && aplicarItem(k, i.cod)}
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
              <table className="w-full min-w-[520px] text-[12.5px]">
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

            {erroModal && <p className="mt-3 rounded-md border border-alert-500/40 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-700">{erroModal}</p>}
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className={BOTAO} onClick={() => setForm(null)}>
                Cancelar
              </button>
              <button
                type="button"
                disabled={salvando}
                onClick={salvar}
                className="rounded-lg bg-navy-900 px-5 py-2 text-[13px] font-medium text-white hover:bg-navy-800 disabled:opacity-40"
              >
                {salvando ? "Gravando…" : form.id ? "Salvar alteração" : "Lançar empréstimo"}
              </button>
            </div>
          </section>
        )}
        <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
          {["Aberto", "Devolvido", "Pago"].map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setFiltroStatus(filtroStatus === s ? "" : s)}
              className={`rounded-xl2 text-left ${filtroStatus === s ? "ring-2 ring-navy-900 dark:ring-crv-acao" : ""}`}
            >
              <Indicador
                cor={COR_RESUMO[s]}
                rotulo={s === "Aberto" ? "Em aberto" : s === "Devolvido" ? "Devolvidos" : "Pagos"}
                valor={brl(resumo[s].valor)}
                apoio={`${resumo[s].n} empréstimo(s)`}
                className="h-full"
              />
            </button>
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
                <th className="px-3 py-2 font-semibold">Boletim</th>
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
                  <tr className="cursor-pointer border-b border-line hover:bg-surface/60" onClick={() => setAberto(aberto === e.id ? null : e.id)}>
                    <td className="px-3 py-2 tabular font-medium text-ink">{e.boletim ?? <span className="text-muted">#{e.id}</span>}</td>
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
                    <tr className="border-b border-line bg-surface/40">
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
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button type="button" className={BOTAO} onClick={() => gerarComunicadoEmprestimoPdf(e)}>
                            Gerar comunicado (PDF)
                          </button>
                          {podeGravar && (
                            <>
                              <button
                                type="button"
                                className={BOTAO}
                                onClick={() => {
                                  setErroModal(null);
                                  setForm(formDe(e));
                                  irParaFormulario();
                                }}
                              >
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

      {baixa && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl2 bg-card p-5 shadow-card">
            <h2 className="text-[15px] font-bold text-ink">
              Dar baixa — empréstimo #{baixa.e.id} · {baixa.e.fornNm}
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
              <button type="button" className={BOTAO} onClick={() => setBaixa(null)}>
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
    </Pagina>
  );
}
