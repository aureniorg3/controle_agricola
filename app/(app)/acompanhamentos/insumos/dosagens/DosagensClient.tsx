"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import BotaoLog from "@/components/BotaoLog";
import { BarraFiltros, CabecalhoPagina, CorpoPagina, Pagina } from "@/components/pagina";
import { validarDosagem, type Dosagem, type ItemDosagem } from "@/lib/dosagens";
import { podeEditar } from "@/lib/permissoes";
import type { PerfilUsuario } from "@/lib/types";
import { ehTexto, usarPersistido } from "@/lib/usar-persistido";
import BotaoLimparFiltros from "@/components/BotaoLimparFiltros";

const INPUT = "w-full rounded-lg border border-line bg-surface px-3 py-2 text-[13px]";
const CELULA = "w-full rounded border border-transparent bg-transparent px-1.5 py-1 text-right tabular hover:border-line focus:border-navy-900 focus:bg-surface focus:outline-none";
const BOTAO = "rounded-lg border border-line bg-card px-3 py-1.5 text-[12.5px] font-semibold text-navy-800 hover:bg-surface disabled:opacity-50";

/** Número digitado (vírgula ou ponto); vazio = null; texto inválido = NaN. */
function numero(v: string): number | null {
  const t = v.trim();
  if (t === "") return null;
  return t.includes(",") ? Number(t.replace(/\./g, "").replace(",", ".")) : Number(t);
}
/** Sem separador de milhar, para o que se mostra voltar a ser lido igual ao digitar. */
const texto = (n: number | null) => (n === null ? "" : n.toLocaleString("pt-BR", { maximumFractionDigits: 6, useGrouping: false }));

export default function DosagensClient({ perfil }: { perfil: PerfilUsuario }) {
  const podeGravar = podeEditar(perfil);
  const [lista, setLista] = useState<Dosagem[]>([]);
  const [cadastroImportado, setCadastroImportado] = useState(true);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [busca, setBusca] = usarPersistido("insumos.dosagens.busca", "", ehTexto);
  const algumFiltroAtivo = busca !== "";
  function limparFiltros() {
    setBusca("");
  }

  // linha de lançamento
  const [novoCod, setNovoCod] = useState("");
  const [novoItem, setNovoItem] = useState<ItemDosagem | null>(null);
  const [novoMin, setNovoMin] = useState("");
  const [novoMax, setNovoMax] = useState("");
  const [novoAviso, setNovoAviso] = useState<{ texto: string; tom: "info" | "alerta" } | null>(null);
  const [sugestoes, setSugestoes] = useState<{ cod: string; ds: string; un: string }[]>([]);
  const [adicionando, setAdicionando] = useState(false);
  const codRef = useRef<HTMLInputElement>(null);
  const novoCodAtual = useRef("");

  // edição das linhas já lançadas
  const [edicoes, setEdicoes] = useState<Record<string, { min: string; max: string }>>({});
  const [salvando, setSalvando] = useState<string | null>(null);

  const carregar = useCallback(async () => {
    setErro(null);
    try {
      const res = await fetch("/api/insumos/dosagens", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Não foi possível carregar as dosagens.");
      setLista(json.dosagens);
      setCadastroImportado(json.cadastroImportado !== false);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível carregar as dosagens.");
    } finally {
      setCarregando(false);
    }
  }, []);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // sugestões do cadastro enquanto se digita o código ou parte do nome
  useEffect(() => {
    const q = novoCod.trim();
    if (q.length < 2 || novoItem?.cod === q) {
      setSugestoes([]);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/insumos/item?q=${encodeURIComponent(q)}`, { cache: "no-store" });
        const json = await res.json();
        setSugestoes(res.ok ? json.itens : []);
      } catch {
        setSugestoes([]);
      }
    }, 250);
    return () => clearTimeout(t);
  }, [novoCod, novoItem]);

  /** Traz do cadastro a descrição e a UM do código digitado (e a dosagem, se ele já tiver). */
  async function consultarItem(cod: string) {
    const c = cod.trim();
    if (!c) {
      setNovoItem(null);
      setNovoAviso(null);
      return;
    }
    try {
      const res = await fetch(`/api/insumos/dosagens?cod=${encodeURIComponent(c)}`, { cache: "no-store" });
      const json = await res.json();
      if (novoCodAtual.current.trim() !== c) return; // o campo mudou enquanto a consulta voltava
      if (!res.ok || !json.item) {
        setNovoItem(null);
        setNovoAviso({ texto: cadastroImportado ? "Código não encontrado no cadastro Material e Insumos." : "Importe o cadastro Material e Insumos para lançar.", tom: "alerta" });
        return;
      }
      setNovoItem(json.item);
      setNovoCod(json.item.cod);
      novoCodAtual.current = json.item.cod;
      if (json.dosagem) {
        setNovoMin(texto(json.dosagem.min));
        setNovoMax(texto(json.dosagem.max));
        setNovoAviso({ texto: "Este insumo já tem dosagem: salvar atualiza os valores.", tom: "info" });
      } else {
        setNovoAviso(null);
      }
    } catch {
      /* segue digitado */
    }
  }

  function limparNovo() {
    setNovoCod("");
    novoCodAtual.current = "";
    setNovoItem(null);
    setNovoMin("");
    setNovoMax("");
    setNovoAviso(null);
    setSugestoes([]);
  }

  async function enviar(cod: string, min: string, max: string): Promise<boolean> {
    const mn = numero(min);
    const mx = numero(max);
    const e = validarDosagem(mn, mx);
    if (e) {
      setErro(e);
      return false;
    }
    try {
      const res = await fetch("/api/insumos/dosagens", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cod, min: mn, max: mx }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Não foi possível salvar.");
      return true;
    } catch (er) {
      setErro(er instanceof Error ? er.message : "Não foi possível salvar.");
      return false;
    }
  }

  async function adicionar() {
    setErro(null);
    if (!novoItem) return setErro("Escolha um insumo do cadastro: digite o código e confira a descrição.");
    setAdicionando(true);
    const ok = await enviar(novoItem.cod, novoMin, novoMax);
    setAdicionando(false);
    if (!ok) return;
    limparNovo();
    await carregar();
    codRef.current?.focus();
  }

  async function salvarLinha(d: Dosagem) {
    const e = edicoes[d.cod];
    if (!e) return;
    setErro(null);
    setSalvando(d.cod);
    const ok = await enviar(d.cod, e.min, e.max);
    setSalvando(null);
    if (!ok) return;
    setEdicoes((prev) => {
      const { [d.cod]: _, ...resto } = prev;
      return resto;
    });
    await carregar();
  }

  async function excluir(d: Dosagem) {
    if (!window.confirm(`Excluir a dosagem de ${d.ds || d.cod}? A exclusão fica registrada no log.`)) return;
    setErro(null);
    try {
      const res = await fetch("/api/insumos/dosagens", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cod: d.cod }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Não foi possível excluir.");
      await carregar();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível excluir.");
    }
  }

  const valorLinha = (d: Dosagem) => edicoes[d.cod] ?? { min: texto(d.min), max: texto(d.max) };
  const alterada = (d: Dosagem) => {
    const e = edicoes[d.cod];
    return !!e && (e.min !== texto(d.min) || e.max !== texto(d.max));
  };
  const editar = (d: Dosagem, campo: "min" | "max", v: string) => setEdicoes((prev) => ({ ...prev, [d.cod]: { ...valorLinha(d), [campo]: v } }));

  const filtradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return q ? lista.filter((d) => `${d.cod} ${d.ds}`.toLowerCase().includes(q)) : lista;
  }, [lista, busca]);

  const th = "px-3 py-2 font-medium";
  const sufixo = (un: string) => <span className="w-[44px] flex-shrink-0 text-[11px] text-muted">{un ? `${un}/ha` : "/ha"}</span>;

  return (
    <Pagina translate="no">
      <CabecalhoPagina
        titulo="Dosagens"
        categoria="Acompanhamentos · Insumos"
        comandos={<BotaoLog titulo="Log das Dosagens" filtro={{ modulo: "Insumos", entidade: "Dosagem" }} />}
      />

      <CorpoPagina>
        <BarraFiltros className="justify-between">
          <div className="flex w-full items-center gap-2 sm:w-auto">
            <div className="w-full sm:w-[280px]">
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar por código ou descrição" className={INPUT} aria-label="Buscar" />
            </div>
            <BotaoLimparFiltros ativo={algumFiltroAtivo} onLimpar={limparFiltros} />
          </div>
          <p className="max-w-[560px] text-[12px] text-muted">
            Dosagem por hectare, na unidade de medida do cadastro Material e Insumos. A descrição e a unidade vêm do cadastro pelo código do insumo.
          </p>
        </BarraFiltros>

        {!cadastroImportado && (
          <p className="mb-3 rounded-md border border-line bg-card px-3 py-2 text-[12.5px] text-muted">
            O cadastro Material e Insumos ainda não foi importado. As descrições e unidades aparecem depois da importação, em Configurações › Cadastros › Material e Insumos.
          </p>
        )}
        {erro && <p className="mb-3 rounded-md border border-alert-500/40 bg-alert-50 px-3 py-2 text-[13px] text-alert-700">{erro}</p>}

        <div className="overflow-x-auto rounded-xl2 border border-line bg-card shadow-card">
          <datalist id="dos-sug">
            {sugestoes.map((x) => (
              <option key={x.cod} value={x.cod}>
                {x.ds} ({x.un})
              </option>
            ))}
          </datalist>
          <table className="w-full min-w-[1040px] text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-surface text-left text-muted">
                <th className={`${th} w-[150px]`}>Código</th>
                <th className={`${th} min-w-[260px]`}>Descrição</th>
                <th className={`${th} w-[70px]`}>U.M.</th>
                <th className={`${th} w-[190px] text-right`}>Dosagem mínima</th>
                <th className={`${th} w-[190px] text-right`}>Dosagem máxima</th>
                <th className={`${th} w-[130px]`}>Lançado por</th>
                <th className={`${th} w-[170px]`}>Última alteração</th>
                <th className="w-[120px]" />
              </tr>
            </thead>
            <tbody>
              {podeGravar && (
                <>
                  <tr className="border-b border-line bg-surface/60 align-middle">
                    <td className="px-2 py-1.5">
                      <input
                        ref={codRef}
                        list="dos-sug"
                        value={novoCod}
                        onChange={(e) => {
                          const v = e.target.value;
                          setNovoCod(v);
                          novoCodAtual.current = v;
                          setNovoItem(null);
                          setNovoAviso(null);
                          if (sugestoes.some((x) => x.cod === v)) consultarItem(v);
                        }}
                        onBlur={() => !novoItem && novoCod.trim() && consultarItem(novoCod)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            e.preventDefault();
                            consultarItem(novoCod);
                          }
                        }}
                        placeholder="Código"
                        className="w-full rounded-lg border border-line bg-card px-2.5 py-1.5 tabular"
                        aria-label="Código do insumo"
                      />
                    </td>
                    <td className="px-3 py-1.5 text-ink">{novoItem ? novoItem.ds : <span className="text-muted">Descrição do cadastro</span>}</td>
                    <td className="px-3 py-1.5 text-ink">{novoItem ? novoItem.un : ""}</td>
                    {(["min", "max"] as const).map((campo) => (
                      <td key={campo} className="px-2 py-1.5">
                        <div className="flex items-center gap-1.5">
                          <input
                            value={campo === "min" ? novoMin : novoMax}
                            onChange={(e) => (campo === "min" ? setNovoMin(e.target.value) : setNovoMax(e.target.value))}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.preventDefault();
                                adicionar();
                              }
                            }}
                            inputMode="decimal"
                            placeholder="0,00"
                            className="w-full rounded-lg border border-line bg-card px-2.5 py-1.5 text-right tabular"
                            aria-label={campo === "min" ? "Dosagem mínima" : "Dosagem máxima"}
                          />
                          {sufixo(novoItem?.un ?? "")}
                        </div>
                      </td>
                    ))}
                    <td colSpan={2} className="px-3 py-1.5 text-[11.5px]">
                      {novoAviso && <span className={novoAviso.tom === "alerta" ? "text-amber-700" : "text-muted"}>{novoAviso.texto}</span>}
                    </td>
                    <td className="px-2 py-1.5 text-right">
                      <button type="button" onClick={adicionar} disabled={adicionando || !novoItem} className="rounded-lg bg-navy-900 px-3 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40">
                        {adicionando ? "Salvando…" : "Adicionar"}
                      </button>
                    </td>
                  </tr>
                </>
              )}

              {carregando && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-muted">
                    Carregando…
                  </td>
                </tr>
              )}
              {!carregando && lista.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-8 text-center text-muted">
                    {podeGravar
                      ? "Nenhuma dosagem cadastrada. Digite o código do insumo na primeira linha, confira a descrição e informe a dosagem mínima e máxima."
                      : "Nenhuma dosagem cadastrada."}
                  </td>
                </tr>
              )}
              {!carregando && lista.length > 0 && filtradas.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-muted">
                    Nenhum insumo encontrado para a busca.
                  </td>
                </tr>
              )}
              {filtradas.map((d) => {
                const v = valorLinha(d);
                const suja = alterada(d);
                return (
                  <tr key={d.cod} className={`border-t border-line/60 align-middle ${suja ? "bg-[#2D8A5A]/[0.06]" : ""}`}>
                    <td className="px-3 py-1.5 tabular text-muted">{d.cod}</td>
                    <td className="px-3 py-1.5 text-ink">{d.noCadastro ? d.ds : <span className={cadastroImportado ? "text-amber-700" : "text-muted"}>{cadastroImportado ? "Fora do cadastro Material e Insumos" : "Aguardando o cadastro"}</span>}</td>
                    <td className="px-3 py-1.5 text-muted">{d.un}</td>
                    {(["min", "max"] as const).map((campo) => (
                      <td key={campo} className="px-2 py-1">
                        {podeGravar ? (
                          <div className="flex items-center gap-1.5">
                            <input
                              value={v[campo]}
                              onChange={(e) => editar(d, campo, e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") {
                                  e.preventDefault();
                                  salvarLinha(d);
                                }
                              }}
                              inputMode="decimal"
                              className={CELULA}
                              aria-label={campo === "min" ? `Dosagem mínima de ${d.ds || d.cod}` : `Dosagem máxima de ${d.ds || d.cod}`}
                            />
                            {sufixo(d.un)}
                          </div>
                        ) : (
                          <div className="flex items-center justify-end gap-1.5 px-1.5 tabular">
                            <span>{texto(campo === "min" ? d.min : d.max) || "—"}</span>
                            {sufixo(d.un)}
                          </div>
                        )}
                      </td>
                    ))}
                    <td className="px-3 py-1.5 text-muted">{d.usr || "—"}</td>
                    <td className="px-3 py-1.5 text-[11.5px] text-muted">{d.atuUsr ? `${d.atuUsr} · ${d.atuEm}` : "—"}</td>
                    <td className="px-2 py-1 text-right">
                      {podeGravar && (
                        <div className="flex items-center justify-end gap-1.5">
                          {suja && (
                            <button type="button" onClick={() => salvarLinha(d)} disabled={salvando === d.cod} className="rounded-lg bg-[#2D8A5A] px-2.5 py-1 text-[12px] font-medium text-white disabled:opacity-50">
                              {salvando === d.cod ? "…" : "Salvar"}
                            </button>
                          )}
                          <button type="button" title="Excluir dosagem" aria-label={`Excluir a dosagem de ${d.ds || d.cod}`} onClick={() => excluir(d)} className={`${BOTAO} border-transparent px-2 text-alert-700 hover:border-line`}>
                            ×
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[11.5px] text-muted">
          {lista.length > 0 ? `${filtradas.length} de ${lista.length} insumo(s) com dosagem. ` : ""}
          Enter na dosagem salva a linha; o que for alterado fica no log.
        </p>
      </CorpoPagina>
    </Pagina>
  );
}
