"use client";

import { useCallback, useEffect, useState } from "react";
import { Campo, ModalShell } from "@/components/ui";
import { fmtDataHora } from "@/lib/format";
import { IconEditar, IconImportar, IconMais } from "@/components/icons";
import { Abas, CabecalhoPagina, Comando, CorpoPagina, Pagina, Painel, Selo } from "@/components/pagina";
import { CADASTROS_SPEC, specPorNomeArquivo, specPorSlug } from "@/lib/cadastros-spec";
import { podeEditar, podeIncluirCadastro } from "@/lib/permissoes";

import { ehTexto, usarPersistido } from "@/lib/usar-persistido";
import BotaoLimparFiltros from "@/components/BotaoLimparFiltros";

const INPUT = "w-full rounded-md border border-line bg-card px-3 py-2 text-[13px] text-ink focus:border-brand-600 focus:outline-none";
const FILTRO = "rounded-md border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink focus:border-brand-600 focus:outline-none";

const ALINHAR = { esquerda: "text-left", direita: "text-right", centro: "text-center" };

export default function CadastroClient({ slug, perfil, categoria = "Configurações · Cadastros" }) {
  const spec = specPorSlug(slug);
  const podeGravar = podeEditar(perfil);
  // analistas lançam e editam, mas não incluem itens novos nem importam nos cadastros
  const podeIncluir = podeIncluirCadastro(perfil);

  const [busca, setBusca] = usarPersistido(`cadastro.${slug}.busca`, "", ehTexto);
  const [termo, setTermo] = useState("");
  const [pagina, setPagina] = useState(1);
  const algumFiltroAtivo = busca !== "";
  function limparFiltros() {
    setBusca("");
    setTermo("");
    setPagina(1);
  }
  const [itens, setItens] = useState([]);
  const [total, setTotal] = useState(0);
  const [tamanho, setTamanho] = useState(50);
  const [carregando, setCarregando] = useState(true);
  const [erroLista, setErroLista] = useState(null);
  const [editando, setEditando] = useState(null);
  const [importarAberto, setImportarAberto] = useState(false);
  const [ajusteAberto, setAjusteAberto] = useState(false);
  // abas do cadastro (ex.: Insumos / Materiais) e quantos itens cada uma tem
  const [aba, setAba] = usarPersistido(`cadastro.${slug}.aba`, spec.abas?.[0]?.id ?? "", ehTexto);
  const abaAtual = spec.abas?.find((a) => a.id === aba) ?? spec.abas?.[0];
  const [totaisAbas, setTotaisAbas] = useState({});
  const colunas = spec.colunas.filter((c) => !c.aba || c.aba === abaAtual?.id);
  // edição na própria linha
  const [linha, setLinha] = useState(null);
  const [salvandoLinha, setSalvandoLinha] = useState(false);
  const [erroLinha, setErroLinha] = useState(null);
  const editavel = (c) => !c.derivada && !spec.chaves.includes(c.chave);

  function editarLinha(i) {
    setErroLinha(null);
    setLinha({ cod: i.cod, valores: Object.fromEntries(colunas.filter(editavel).map((c) => [c.chave, String(i.dados[c.chave] ?? "")])) });
  }

  async function salvarLinha() {
    if (!linha) return;
    setSalvandoLinha(true);
    setErroLinha(null);
    try {
      const dados = {};
      for (const c of colunas.filter(editavel)) {
        const v = (linha.valores[c.chave] ?? "").trim();
        dados[c.chave] = v !== "" && /^-?\d+([.,]\d+)?$/.test(v) && c.alinhar === "direita" ? Number(v.replace(",", ".")) : v;
      }
      const res = await fetch(`/api/cadastros/${slug}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cod: linha.cod, dados }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Não foi possível salvar.");
      setLinha(null);
      carregar();
    } catch (e) {
      setErroLinha(e instanceof Error ? e.message : "Não foi possível salvar.");
    } finally {
      setSalvandoLinha(false);
    }
  }

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErroLista(null);
    try {
      const res = await fetch(`/api/cadastros/${slug}?q=${encodeURIComponent(termo)}&pg=${pagina}${abaAtual ? `&aba=${abaAtual.id}` : ""}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Não foi possível carregar o cadastro.");
      setItens(json.itens);
      setTotaisAbas(json.abas ?? {});
      setTotal(json.total);
      setTamanho(json.tamanho);
    } catch (e) {
      setErroLista(e instanceof Error ? e.message : "Não foi possível carregar o cadastro.");
    } finally {
      setCarregando(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, termo, pagina, abaAtual?.id]);

  useEffect(() => {
    carregar();
  }, [carregar]);

  // busca com um pequeno atraso, para não consultar a cada tecla
  useEffect(() => {
    const t = setTimeout(() => {
      setPagina(1);
      setTermo(busca);
    }, 350);
    return () => clearTimeout(t);
  }, [busca]);

  const totalPaginas = Math.max(1, Math.ceil(total / tamanho));

  async function excluir(i) {
    if (!window.confirm(`Excluir "${i.nm || i.cod}" do cadastro de ${spec.titulo}?`)) return;
    const res = await fetch(`/api/cadastros/${slug}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cod: i.cod }),
    });
    if (res.ok) carregar();
    else window.alert((await res.json().catch(() => ({}))).error ?? "Não foi possível excluir.");
  }

  return (
    <Pagina>
      <CabecalhoPagina
        titulo={spec.titulo}
        categoria={categoria}
        info={!podeGravar && <Selo>Somente leitura</Selo>}
        comandos={
          <>
            {podeIncluir && (
              <>
                <Comando primario icone={<IconMais size={16} />} onClick={() => setEditando({ novo: true, item: null })}>
                  Novo
                </Comando>
                <Comando icone={<IconImportar size={16} />} onClick={() => setImportarAberto(true)}>
                  Importar planilhas
                </Comando>
              </>
            )}
            {podeIncluir && spec.ajuste && (
              <Comando icone={<IconEditar size={16} />} onClick={() => setAjusteAberto(true)} title={spec.ajuste.descricao}>
                {spec.ajuste.rotulo}
              </Comando>
            )}
          </>
        }
        abas={
          spec.abas && (
            <Abas
              itens={spec.abas.map((a) => ({
                id: a.id,
                title: a.descricao,
                label: (
                  <>
                    {a.rotulo}
                    {totaisAbas[a.id] !== undefined && (
                      <span className="ml-1.5 text-[11.5px] font-normal text-muted">{totaisAbas[a.id].toLocaleString("pt-BR")}</span>
                    )}
                  </>
                ),
              }))}
              ativo={abaAtual?.id ?? ""}
              onChange={(id) => {
                setAba(id);
                setPagina(1);
                setLinha(null);
              }}
            />
          )
        }
      />

      <CorpoPagina>
        <Painel
          semEspaco
          titulo={abaAtual ? `${spec.titulo} · ${abaAtual.rotulo}` : spec.titulo}
          subtitulo={abaAtual?.descricao}
          acoes={
            <>
              <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar…" className={`${FILTRO} min-w-[220px]`} />
              <BotaoLimparFiltros ativo={algumFiltroAtivo} onLimpar={limparFiltros} />
              <span className="ml-1.5 text-[12px] text-muted">
                {total.toLocaleString("pt-BR")} registro{total === 1 ? "" : "s"}
              </span>
            </>
          }
        >
          {erroLista && <p className="px-4 py-3 text-[12.5px] font-medium text-alert-600">{erroLista}</p>}
          {erroLinha && <p className="px-4 py-2 text-[12.5px] font-medium text-alert-600">{erroLinha}</p>}

          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-surface text-muted">
                  {colunas.map((c) => (
                    <th
                      key={c.chave}
                      style={c.largura ? { minWidth: c.largura } : undefined}
                      className={`whitespace-nowrap px-3 py-2 font-semibold ${ALINHAR[c.alinhar ?? "esquerda"]}`}
                    >
                      {c.rotulo}
                    </th>
                  ))}
                  <th className="whitespace-nowrap px-3 py-2 font-semibold">Lançado por</th>
                  <th className="whitespace-nowrap px-3 py-2 font-semibold">Última alteração</th>
                  <th className="w-28 px-2 py-2 text-right font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((i) => {
                  const emEdicao = linha?.cod === i.cod;
                  return (
                    <tr key={i.cod} className={`border-b border-line last:border-0 ${emEdicao ? "bg-[#2E5FA8]/[0.06]" : ""}`}>
                      {colunas.map((c) => (
                        <td key={c.chave} className={`px-3 py-1.5 text-ink ${ALINHAR[c.alinhar ?? "esquerda"]}`}>
                          {emEdicao && editavel(c) ? (
                            <input
                              value={linha.valores[c.chave] ?? ""}
                              onChange={(e) => setLinha((l) => (l ? { ...l, valores: { ...l.valores, [c.chave]: e.target.value } } : l))}
                              onKeyDown={(e) => {
                                if (e.key === "Enter") salvarLinha();
                                if (e.key === "Escape") setLinha(null);
                              }}
                              autoFocus={colunas.filter(editavel)[0]?.chave === c.chave}
                              className={`w-full min-w-[80px] rounded border border-brand-600/50 bg-card px-1.5 py-0.5 text-[12.5px] text-ink focus:border-brand-600 focus:outline-none ${ALINHAR[c.alinhar ?? "esquerda"]}`}
                            />
                          ) : (
                            String(i.dados[c.chave] ?? "")
                          )}
                        </td>
                      ))}
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted">{i.lancadoPor || "—"}</td>
                      <td className="whitespace-nowrap px-3 py-1.5 text-muted">
                        {i.alteradoEm ? `${i.alteradoPor || "—"} · ${fmtDataHora(i.alteradoEm)}` : ""}
                      </td>
                      <td className="whitespace-nowrap px-2 py-1.5 text-right">
                        {podeGravar && emEdicao && (
                          <>
                            <button
                              type="button"
                              onClick={salvarLinha}
                              disabled={salvandoLinha}
                              className="mr-1 rounded bg-navy-900 px-2 py-0.5 text-[12px] font-semibold text-white hover:bg-navy-800 disabled:opacity-50"
                            >
                              {salvandoLinha ? "Salvando…" : "Salvar"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setLinha(null)}
                              className="rounded px-1.5 py-0.5 text-[12px] font-semibold text-muted hover:bg-surface"
                            >
                              Cancelar
                            </button>
                          </>
                        )}
                        {podeGravar && !emEdicao && (
                          <>
                            <button
                              type="button"
                              onClick={() => editarLinha(i)}
                              className="mr-1 rounded px-1.5 py-0.5 text-[12px] font-semibold text-brand-700 hover:bg-brand-50"
                            >
                              Editar
                            </button>
                            <button
                              type="button"
                              onClick={() => excluir(i)}
                              aria-label="Excluir"
                              className="rounded px-1.5 text-[15px] leading-none text-muted hover:bg-alert-50 hover:text-alert-600"
                            >
                              ×
                            </button>
                          </>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!carregando && itens.length === 0 && (
                  <tr>
                    <td colSpan={colunas.length + 3} className="px-4 py-10 text-center text-muted">
                      {termo
                        ? "Nenhum registro encontrado para a busca."
                        : podeGravar
                          ? 'Nenhum registro ainda. Use "Importar planilhas" para carregar a planilha deste cadastro.'
                          : "Nenhum registro ainda."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-line bg-surface px-4 py-2 text-[12.5px] text-muted">
            <span>{carregando ? "Carregando…" : `Página ${pagina} de ${totalPaginas}`}</span>
            <span className="flex gap-1.5">
              <button
                type="button"
                disabled={pagina <= 1 || carregando}
                onClick={() => setPagina((p) => p - 1)}
                className="rounded-md border border-line bg-card px-2.5 py-1 font-semibold text-navy-800 disabled:opacity-40"
              >
                Anterior
              </button>
              <button
                type="button"
                disabled={pagina >= totalPaginas || carregando}
                onClick={() => setPagina((p) => p + 1)}
                className="rounded-md border border-line bg-card px-2.5 py-1 font-semibold text-navy-800 disabled:opacity-40"
              >
                Próxima
              </button>
            </span>
          </div>
        </Painel>
      </CorpoPagina>

      {editando && (
        <EditarModal
          spec={spec}
          aba={abaAtual?.id}
          novo={editando.novo}
          item={editando.item}
          onFechar={() => setEditando(null)}
          onSalvo={() => {
            setEditando(null);
            carregar();
          }}
        />
      )}
      {ajusteAberto && (
        <AjusteModal
          spec={spec}
          onFechar={() => {
            setAjusteAberto(false);
            carregar();
          }}
        />
      )}
      {importarAberto && (
        <ImportarModal
          cadastroAtual={spec.slug}
          onFechar={() => {
            setImportarAberto(false);
            carregar();
          }}
        />
      )}
    </Pagina>
  );
}

function EditarModal({ spec, aba, novo, item, onFechar, onSalvo }) {
  const colunasForm = spec.colunas.filter((c) => !c.derivada && (!c.aba || c.aba === aba));
  const [valores, setValores] = useState(() => Object.fromEntries(spec.colunas.map((c) => [c.chave, String(item?.dados[c.chave] ?? "")])));
  // sugestões do cadastro de origem para colunas com `ref` (ex.: Região em Responsável Região)
  const [sugestoes, setSugestoes] = useState(null);

  async function buscarSugestoes(chave, ref, termo) {
    try {
      const res = await fetch(`/api/cadastros/${ref}?q=${encodeURIComponent(termo.trim())}&pg=1`, { cache: "no-store" });
      const j = await res.json();
      if (res.ok) setSugestoes({ chave, itens: j.itens.slice(0, 8) });
    } catch {
      /* sem sugestões, o código ainda é conferido ao salvar */
    }
  }
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);

  async function salvar(e) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      const dados = {};
      for (const c of colunasForm) {
        const v = valores[c.chave].trim();
        dados[c.chave] = v !== "" && /^-?\d+([.,]\d+)?$/.test(v) && c.alinhar === "direita" ? Number(v.replace(",", ".")) : v;
      }
      const res = await fetch(`/api/cadastros/${spec.slug}`, {
        method: novo ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(novo ? { dados } : { cod: item.cod, dados }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Não foi possível salvar.");
      onSalvo();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível salvar.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <ModalShell titulo={`${novo ? "Novo" : "Editar"} · ${spec.titulo}`} onFechar={onFechar}>
      <form onSubmit={salvar} className="space-y-3">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {colunasForm.map((c) => (
            <div key={c.chave} className="relative">
              <Campo label={c.rotulo}>
                <input
                  value={valores[c.chave]}
                  onChange={(e) => {
                    setValores((v) => ({ ...v, [c.chave]: e.target.value }));
                    if (c.ref) buscarSugestoes(c.chave, c.ref, e.target.value);
                  }}
                  onFocus={() => c.ref && buscarSugestoes(c.chave, c.ref, valores[c.chave])}
                  onBlur={() => setTimeout(() => setSugestoes(null), 150)}
                  autoComplete="off"
                  disabled={!novo && spec.chaves.includes(c.chave)}
                  className={`${INPUT} disabled:bg-surface disabled:text-muted`}
                />
              </Campo>
              {c.ref && sugestoes?.chave === c.chave && sugestoes.itens.length > 0 && (
                <ul className="absolute left-0 right-0 z-10 mt-1 max-h-48 overflow-y-auto rounded-md border border-line bg-card shadow-pop">
                  {sugestoes.itens.map((s) => (
                    <li key={s.cod}>
                      <button
                        type="button"
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => {
                          setValores((v) => ({ ...v, [c.chave]: s.cod }));
                          setSugestoes(null);
                        }}
                        className="flex w-full items-center gap-3 px-3 py-1.5 text-left text-[12.5px] text-ink hover:bg-surface"
                      >
                        <span className="w-10 flex-shrink-0 font-semibold tabular">{s.cod}</span>
                        <span className="truncate">{s.nm}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {c.ref && (
                <p className="mt-0.5 text-[11px] text-muted">
                  Código do cadastro {specPorSlug(c.ref)?.titulo ?? c.ref}
                  {c.aceitaNome ? " (ou o nome)" : ""}; a descrição vem de lá.
                </p>
              )}
            </div>
          ))}
        </div>
        {erro && <div className="rounded-lg border border-alert-500/30 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-600">{erro}</div>}
        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onFechar} className="rounded-lg border border-line px-3.5 py-1.5 text-[13px] font-semibold text-ink hover:bg-surface">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={salvando}
            className="rounded-lg bg-navy-900 px-3.5 py-1.5 text-[13px] font-semibold text-white shadow-card hover:bg-navy-800 disabled:opacity-50"
          >
            {salvando ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </form>
    </ModalShell>
  );
}

function ImportarModal({ cadastroAtual, onFechar }) {
  const [arquivos, setArquivos] = useState([]);
  const [enviando, setEnviando] = useState(false);
  const [resultados, setResultados] = useState(null);
  const [erro, setErro] = useState(null);

  function escolher(files) {
    if (!files) return;
    setArquivos(
      Array.from(files)
        .slice(0, 12)
        // o nome do arquivo é o nome do cadastro; sem correspondência, vale o cadastro desta tela
        .map((arquivo) => ({ arquivo, cadastro: specPorNomeArquivo(arquivo.name)?.slug ?? cadastroAtual, ajustar: true })),
    );
  }

  async function enviar() {
    setEnviando(true);
    setErro(null);
    setResultados(null);
    try {
      const form = new FormData();
      arquivos.forEach((a, i) => {
        form.append(`arquivo_${i}`, a.arquivo);
        form.append(`cad_${i}`, a.cadastro);
        if (a.ajustar && specPorSlug(a.cadastro)?.ajuste) form.append(`ajustar_${i}`, "1");
      });
      const res = await fetch("/api/cadastros/importar", { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setErro(json.error ?? "Não foi possível importar os arquivos.");
        return;
      }
      setResultados(json.resultados);
    } catch {
      setErro("Não foi possível enviar os arquivos. Verifique a conexão e tente novamente.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <ModalShell titulo="Importar planilhas de cadastro" onFechar={onFechar}>
      <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
        Selecione uma ou mais planilhas (até 12). Cada arquivo é ligado ao cadastro pelo <b className="text-ink">nome do arquivo</b> (ex.: &quot;Tipo de
        Solo.xlsx&quot; vai para Tipos de Solo) e conferido pelas colunas antes de gravar. Itens novos entram, os de mesmo código são atualizados e o restante
        do cadastro é mantido.
      </p>
      <input
        type="file"
        multiple
        accept=".xlsx,.xls"
        onChange={(e) => escolher(e.target.files)}
        className="block w-full text-[12.5px] text-ink file:mr-3 file:rounded-md file:border-0 file:bg-navy-900 file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-white"
      />

      {arquivos.length > 0 && (
        <div className="mt-3 space-y-2">
          {arquivos.map((a, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-surface p-2">
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{a.arquivo.name}</span>
              <select
                value={a.cadastro}
                onChange={(e) => setArquivos((prev) => prev.map((x, idx) => (idx === i ? { ...x, cadastro: e.target.value } : x)))}
                aria-label={`Cadastro do arquivo ${a.arquivo.name}`}
                className={FILTRO}
              >
                {CADASTROS_SPEC.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.titulo}
                  </option>
                ))}
              </select>
              {specPorSlug(a.cadastro)?.ajuste && (
                <label className="flex w-full items-start gap-2 rounded-md bg-card px-2 py-1.5 text-[12px] text-ink">
                  <input
                    type="checkbox"
                    className="mt-0.5"
                    checked={a.ajustar}
                    onChange={(e) => setArquivos((prev) => prev.map((x, idx) => (idx === i ? { ...x, ajustar: e.target.checked } : x)))}
                  />
                  <span>
                    <b className="font-semibold">{specPorSlug(a.cadastro).ajuste.rotulo}</b> na importação
                    <span className="block text-muted">{specPorSlug(a.cadastro).ajuste.descricao}</span>
                  </span>
                </label>
              )}
            </div>
          ))}
        </div>
      )}

      {erro && <div className="mt-3 rounded-lg border border-alert-500/30 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-600">{erro}</div>}

      {resultados && (
        <div className="mt-3 space-y-1.5">
          {resultados.map((r, i) => (
            <div
              key={i}
              className={`rounded-lg border px-3 py-2 text-[12.5px] ${
                r.ok ? "border-good-500/30 bg-good-50 text-good-600" : "border-alert-500/30 bg-alert-50 text-alert-600"
              }`}
            >
              <p className="font-semibold">
                {r.nome} → {r.titulo}
              </p>
              {r.ok ? (
                <p>
                  {r.lidos.toLocaleString("pt-BR")} registro(s): {r.novos.toLocaleString("pt-BR")} novo(s), {r.atualizados.toLocaleString("pt-BR")}{" "}
                  atualizado(s).
                </p>
              ) : (
                <p>{r.erro}</p>
              )}
              {r.avisos.map((a, j) => (
                <p key={j} className="text-amber-600">
                  {a}
                </p>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onFechar} className="rounded-lg border border-line px-4 py-2 text-[13px] font-semibold text-ink">
          {resultados ? "Fechar" : "Cancelar"}
        </button>
        <button
          type="button"
          disabled={arquivos.length === 0 || enviando}
          onClick={enviar}
          className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
        >
          {enviando ? "Importando…" : "Importar"}
        </button>
      </div>
    </ModalShell>
  );
}

/** Correção dos itens já gravados (ex.: Descrição Fazenda sem o número e o traço na frente), com prévia antes de gravar. */
function AjusteModal({ spec, onFechar }) {
  const [previa, setPrevia] = useState(null);
  const [feito, setFeito] = useState(null);
  const [aplicando, setAplicando] = useState(false);
  const [erro, setErro] = useState(null);

  useEffect(() => {
    fetch(`/api/cadastros/ajustar?slug=${spec.slug}`, { cache: "no-store" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => (ok ? setPrevia(j) : setErro(j.error ?? "Não foi possível montar a prévia.")))
      .catch(() => setErro("Não foi possível montar a prévia."));
  }, [spec.slug]);

  async function aplicar() {
    setAplicando(true);
    setErro(null);
    try {
      const res = await fetch("/api/cadastros/ajustar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: spec.slug }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Não foi possível corrigir.");
      setFeito(j);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível corrigir.");
    } finally {
      setAplicando(false);
    }
  }

  const r = feito ?? previa;
  return (
    <ModalShell titulo={spec.ajuste.rotulo} onFechar={onFechar}>
      <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
        {spec.ajuste.descricao}
        {spec.slug === "fazendas" &&
          " Depois de corrigir, a Descrição Fazenda é gravada também nas ordens, talhões, pesagens, histórico de safras, O.S., apontamentos e empréstimos."}
      </p>
      {!r && !erro && <p className="text-[12.5px] text-muted">Conferindo o cadastro…</p>}
      {r && (
        <>
          <p className="mb-2 text-[12.5px] text-ink">
            {feito ? (
              <>
                <b>{feito.alterados.toLocaleString("pt-BR")}</b> de {feito.total.toLocaleString("pt-BR")} registro(s) corrigido(s).
              </>
            ) : r.alterados === 0 ? (
              <>Nada a corrigir: os {r.total.toLocaleString("pt-BR")} registros já estão certos.</>
            ) : (
              <>
                <b>{r.alterados.toLocaleString("pt-BR")}</b> de {r.total.toLocaleString("pt-BR")} registro(s) mudam:
              </>
            )}
          </p>
          {r.exemplos.length > 0 && (
            <div className="max-h-64 overflow-y-auto rounded-lg border border-line">
              <table className="w-full text-[12px]">
                <thead>
                  <tr className="border-b border-line bg-surface text-left text-muted">
                    <th className="px-3 py-1.5 font-medium">Código</th>
                    <th className="px-3 py-1.5 font-medium">Antes</th>
                    <th className="px-3 py-1.5 font-medium">Depois</th>
                  </tr>
                </thead>
                <tbody>
                  {r.exemplos.map((x) => (
                    <tr key={x.cod} className="border-t border-line/60">
                      <td className="px-3 py-1 tabular text-muted">{x.cod}</td>
                      <td className="px-3 py-1 text-muted line-through decoration-alert-500/50">{x.antes}</td>
                      <td className="px-3 py-1 text-ink">{x.depois}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {r.alterados > r.exemplos.length && (
            <p className="mt-1 text-[11.5px] text-muted">
              Mostrando {r.exemplos.length} de {r.alterados}.
            </p>
          )}
          {feito && feito.sincronizado.length > 0 && (
            <div className="mt-3 rounded-lg border border-good-500/30 bg-good-50 px-3 py-2 text-[12.5px] text-good-700">
              Descrição Fazenda atualizada no sistema:
              <ul className="mt-1 list-disc pl-5">
                {feito.sincronizado.map((x) => (
                  <li key={x.rotulo}>
                    {x.rotulo}: {x.linhas.toLocaleString("pt-BR")} registro(s)
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      {erro && <div className="mt-3 rounded-lg border border-alert-500/30 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-600">{erro}</div>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onFechar} className="rounded-lg border border-line px-4 py-2 text-[13px] font-semibold text-ink">
          {feito ? "Fechar" : "Cancelar"}
        </button>
        {!feito && (
          <button
            type="button"
            disabled={!previa || aplicando || (previa.alterados === 0 && spec.slug !== "fazendas")}
            onClick={aplicar}
            className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-40"
          >
            {aplicando ? "Corrigindo…" : previa && previa.alterados === 0 ? "Atualizar o sistema" : "Corrigir"}
          </button>
        )}
      </div>
    </ModalShell>
  );
}
