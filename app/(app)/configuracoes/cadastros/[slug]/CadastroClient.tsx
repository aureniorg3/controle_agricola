"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { Campo, ModalShell } from "@/components/ui";
import {
  CADASTROS_SPEC,
  specPorNomeArquivo,
  specPorSlug,
  type DadosCadastro,
  type CadastroSpec,
} from "@/lib/cadastros-spec";
import { podeEditar } from "@/lib/permissoes";
import type { PerfilUsuario } from "@/lib/types";

const INPUT =
  "w-full rounded-md border border-line bg-card px-3 py-2 text-[13px] text-ink focus:border-brand-600 focus:outline-none";
const FILTRO =
  "rounded-md border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink focus:border-brand-600 focus:outline-none";

interface Item {
  cod: string;
  nm: string;
  dados: DadosCadastro;
}

const ALINHAR = { esquerda: "text-left", direita: "text-right", centro: "text-center" } as const;

export default function CadastroClient({
  slug,
  perfil,
  categoria = "Configurações · Cadastros",
}: {
  slug: string;
  perfil: PerfilUsuario;
  categoria?: string;
}) {
  const spec = specPorSlug(slug) as CadastroSpec;
  const podeGravar = podeEditar(perfil);

  const [busca, setBusca] = useState("");
  const [termo, setTermo] = useState("");
  const [pagina, setPagina] = useState(1);
  const [itens, setItens] = useState<Item[]>([]);
  const [total, setTotal] = useState(0);
  const [tamanho, setTamanho] = useState(50);
  const [carregando, setCarregando] = useState(true);
  const [erroLista, setErroLista] = useState<string | null>(null);
  const [editando, setEditando] = useState<{ novo: boolean; item: Item | null } | null>(null);
  const [importarAberto, setImportarAberto] = useState(false);

  const carregar = useCallback(async () => {
    setCarregando(true);
    setErroLista(null);
    try {
      const res = await fetch(`/api/cadastros/${slug}?q=${encodeURIComponent(termo)}&pg=${pagina}`, { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? "Não foi possível carregar o cadastro.");
      setItens(json.itens);
      setTotal(json.total);
      setTamanho(json.tamanho);
    } catch (e) {
      setErroLista(e instanceof Error ? e.message : "Não foi possível carregar o cadastro.");
    } finally {
      setCarregando(false);
    }
  }, [slug, termo, pagina]);

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

  async function excluir(i: Item) {
    if (!window.confirm(`Excluir "${i.nm || i.cod}" do cadastro de ${spec.titulo}?`)) return;
    const res = await fetch(`/api/cadastros/${slug}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cod: i.cod }),
    });
    if (res.ok) carregar();
    else window.alert("Não foi possível excluir.");
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-shrink-0 items-center gap-3 border-b border-line bg-card px-6 py-3">
        <nav className="min-w-0 flex-1 text-[13px] text-muted">
          <span className="text-[11px] uppercase tracking-wide">{categoria}</span>
          <div className="truncate text-[15px] font-bold text-ink">{spec.titulo}</div>
        </nav>
        {!podeGravar && (
          <div className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-muted">
            Somente leitura
          </div>
        )}
        {podeGravar && (
          <>
            <button
              type="button"
              onClick={() => setImportarAberto(true)}
              className="rounded-lg border border-line bg-card px-3.5 py-2 text-[13px] font-semibold text-navy-800 shadow-card hover:bg-surface"
            >
              Importar planilhas
            </button>
            <button
              type="button"
              onClick={() => setEditando({ novo: true, item: null })}
              className="rounded-lg bg-navy-900 px-3.5 py-2 text-[13px] font-semibold text-white shadow-card hover:bg-navy-800"
            >
              Novo
            </button>
          </>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="overflow-hidden rounded-xl2 border border-line bg-card shadow-card">
          <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface px-4 py-2.5">
            <h2 className="text-[14px] font-bold text-ink">{spec.titulo}</h2>
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar…"
              className={`${FILTRO} min-w-[220px]`}
            />
            <span className="ml-auto text-[12px] text-muted">
              {total.toLocaleString("pt-BR")} registro{total === 1 ? "" : "s"}
            </span>
          </div>

          {erroLista && <p className="px-4 py-3 text-[12.5px] font-medium text-alert-600">{erroLista}</p>}

          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-surface text-muted">
                  {spec.colunas.map((c) => (
                    <th
                      key={c.chave}
                      style={c.largura ? { minWidth: c.largura } : undefined}
                      className={`whitespace-nowrap px-3 py-2 font-semibold ${ALINHAR[c.alinhar ?? "esquerda"]}`}
                    >
                      {c.rotulo}
                    </th>
                  ))}
                  <th className="w-28 px-2 py-2 text-right font-semibold">Ações</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((i) => (
                  <tr key={i.cod} className="border-b border-line last:border-0">
                    {spec.colunas.map((c) => (
                      <td key={c.chave} className={`px-3 py-1.5 text-ink ${ALINHAR[c.alinhar ?? "esquerda"]}`}>
                        {String(i.dados[c.chave] ?? "")}
                      </td>
                    ))}
                    <td className="px-2 py-1.5 text-right">
                      {podeGravar && (
                        <>
                          <button
                            type="button"
                            onClick={() => setEditando({ novo: false, item: i })}
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
                ))}
                {!carregando && itens.length === 0 && (
                  <tr>
                    <td colSpan={spec.colunas.length + 1} className="px-4 py-10 text-center text-muted">
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
        </div>
      </div>

      {editando && (
        <EditarModal
          spec={spec}
          novo={editando.novo}
          item={editando.item}
          onFechar={() => setEditando(null)}
          onSalvo={() => {
            setEditando(null);
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
    </div>
  );
}

function EditarModal({
  spec,
  novo,
  item,
  onFechar,
  onSalvo,
}: {
  spec: CadastroSpec;
  novo: boolean;
  item: Item | null;
  onFechar: () => void;
  onSalvo: () => void;
}) {
  const [valores, setValores] = useState<Record<string, string>>(() =>
    Object.fromEntries(spec.colunas.map((c) => [c.chave, String(item?.dados[c.chave] ?? "")]))
  );
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  async function salvar(e: FormEvent) {
    e.preventDefault();
    setErro(null);
    setSalvando(true);
    try {
      const dados: Record<string, string | number> = {};
      for (const c of spec.colunas) {
        const v = valores[c.chave].trim();
        dados[c.chave] = v !== "" && /^-?\d+([.,]\d+)?$/.test(v) && c.alinhar === "direita" ? Number(v.replace(",", ".")) : v;
      }
      const res = await fetch(`/api/cadastros/${spec.slug}`, {
        method: novo ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(novo ? { dados } : { cod: item!.cod, dados }),
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
          {spec.colunas.map((c) => (
            <Campo key={c.chave} label={c.rotulo}>
              <input
                value={valores[c.chave]}
                onChange={(e) => setValores((v) => ({ ...v, [c.chave]: e.target.value }))}
                disabled={!novo && spec.chaves.includes(c.chave)}
                className={`${INPUT} disabled:bg-surface disabled:text-muted`}
              />
            </Campo>
          ))}
        </div>
        {erro && (
          <div className="rounded-lg border border-alert-500/30 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-600">{erro}</div>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={onFechar}
            className="rounded-lg border border-line px-3.5 py-1.5 text-[13px] font-semibold text-ink hover:bg-surface"
          >
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

interface ArquivoSel {
  arquivo: File;
  cadastro: string;
}

interface ResultadoArquivo {
  nome: string;
  titulo: string;
  ok: boolean;
  lidos: number;
  novos: number;
  atualizados: number;
  avisos: string[];
  erro?: string;
}

function ImportarModal({ cadastroAtual, onFechar }: { cadastroAtual: string; onFechar: () => void }) {
  const [arquivos, setArquivos] = useState<ArquivoSel[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [resultados, setResultados] = useState<ResultadoArquivo[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  function escolher(files: FileList | null) {
    if (!files) return;
    setArquivos(
      Array.from(files)
        .slice(0, 12)
        // o nome do arquivo é o nome do cadastro; sem correspondência, vale o cadastro desta tela
        .map((arquivo) => ({ arquivo, cadastro: specPorNomeArquivo(arquivo.name)?.slug ?? cadastroAtual }))
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
        Selecione uma ou mais planilhas (até 12). Cada arquivo é ligado ao cadastro pelo <b className="text-ink">nome do
        arquivo</b> (ex.: &quot;Tipo de Solo.xlsx&quot; vai para Tipos de Solo) e conferido pelas colunas antes de
        gravar. Itens novos entram, os de mesmo código são atualizados e o restante do cadastro é mantido.
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
                onChange={(e) =>
                  setArquivos((prev) => prev.map((x, idx) => (idx === i ? { ...x, cadastro: e.target.value } : x)))
                }
                aria-label={`Cadastro do arquivo ${a.arquivo.name}`}
                className={FILTRO}
              >
                {CADASTROS_SPEC.map((s) => (
                  <option key={s.slug} value={s.slug}>
                    {s.titulo}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {erro && (
        <div className="mt-3 rounded-lg border border-alert-500/30 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-600">{erro}</div>
      )}

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
                  {r.lidos.toLocaleString("pt-BR")} registro(s): {r.novos.toLocaleString("pt-BR")} novo(s),{" "}
                  {r.atualizados.toLocaleString("pt-BR")} atualizado(s).
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
