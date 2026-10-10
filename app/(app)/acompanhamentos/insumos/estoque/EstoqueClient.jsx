"use client";

import { Fragment, useEffect, useState } from "react";
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

        {dados?.dt && (
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <Indicador cor="azul" rotulo="Valor em estoque" valor={brl(tot.vr)} apoio={`${fmtDateBR(dados.dt)} · ${empresasTexto}`} />
            <Indicador cor="verde" rotulo="Hectares (estoque ÷ dose)" valor={nf(tot.ha)} unidade="ha" apoio="Soma dos produtos com dosagem" />
            <Indicador cor="cinza" rotulo="Produtos" valor={String(linhas.length)} apoio={gruposTexto} />
            <Indicador
              cor={comDif > 0 ? "laranja" : "verde"}
              rotulo="Real × disponível"
              valor={comDif ? `${comDif} com diferença` : "Sem diferença"}
              apoio={`Diferença total ${nf(tot.dif, 3)}`}
            />
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
