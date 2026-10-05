"use client";

import { useCallback, useEffect, useState } from "react";
import { Campo, ModalShell } from "@/components/ui";
import { IconImportar } from "@/components/icons";
import { fmtDateBR, fmtHa } from "@/lib/format";
import { podeEditar } from "@/lib/permissoes";
import type { LinhaResumoRodada } from "@/lib/rodadas";
import type { PerfilUsuario } from "@/lib/types";
import { ehBooleano, ehDataIso, ehTexto, ehUmDe, usarPersistido } from "@/lib/usar-persistido";

const FILTRO =
  "rounded-md border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink focus:border-brand-600 focus:outline-none";

interface Opcoes {
  rodadas: number[];
  regioes: string[];
  semanas: number[];
}

export default function ResumoClient({ perfil }: { perfil: PerfilUsuario }) {
  const podeGravar = podeEditar(perfil);
  const [rod, setRod] = usarPersistido("rodadas.resumo.rod", "", ehTexto);
  const [reg, setReg] = usarPersistido("rodadas.resumo.reg", "", ehTexto);
  const [sem, setSem] = usarPersistido("rodadas.resumo.sem", "", ehTexto);
  const [ori, setOri] = usarPersistido("rodadas.resumo.origem", "", ehTexto);
  const [busca, setBusca] = usarPersistido("rodadas.resumo.busca", "", ehTexto);
  const [termo, setTermo] = useState("");
  const [pagina, setPagina] = useState(1);
  const [linhas, setLinhas] = useState<LinhaResumoRodada[]>([]);
  const [total, setTotal] = useState(0);
  const [boletins, setBoletins] = useState(0);
  const [areaHa, setAreaHa] = useState(0);
  const [tamanho, setTamanho] = useState(100);
  const [opcoes, setOpcoes] = useState<Opcoes | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [importarAberto, setImportarAberto] = useState(false);
  const [padronizarAberto, setPadronizarAberto] = useState(false);

  const carregar = useCallback(
    async (comOpcoes = false) => {
      setCarregando(true);
      setErro(null);
      try {
        const p = new URLSearchParams({ pg: String(pagina) });
        if (rod) p.set("rod", rod);
        if (reg) p.set("reg", reg);
        if (sem) p.set("sem", sem);
        if (ori) p.set("ori", ori);
        if (termo) p.set("q", termo);
        if (comOpcoes || !opcoes) p.set("opcoes", "1");
        const res = await fetch(`/api/rodadas/resumo?${p}`, { cache: "no-store" });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? "Não foi possível carregar o resumo.");
        setLinhas(json.linhas);
        setTotal(json.total);
        setBoletins(json.boletins);
        setAreaHa(json.areaHa);
        setTamanho(json.tamanho);
        if (json.opcoes) setOpcoes(json.opcoes);
      } catch (e) {
        setErro(e instanceof Error ? e.message : "Não foi possível carregar o resumo.");
      } finally {
        setCarregando(false);
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pagina, rod, reg, sem, ori, termo]
  );

  useEffect(() => {
    carregar();
  }, [carregar]);

  useEffect(() => {
    const t = setTimeout(() => {
      setPagina(1);
      setTermo(busca);
    }, 350);
    return () => clearTimeout(t);
  }, [busca]);

  const totalPaginas = Math.max(1, Math.ceil(total / tamanho));
  const mudar = (fn: () => void) => {
    fn();
    setPagina(1);
  };

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-shrink-0 items-center gap-3 border-b border-line bg-card px-6 py-3">
        <nav className="min-w-0 flex-1 text-[13px] text-muted">
          <span className="text-[11px] uppercase tracking-wide">Rodadas de Campo</span>
          <div className="truncate text-[15px] font-bold text-ink">Resumo</div>
        </nav>
        {!podeGravar && (
          <div className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-muted">
            Somente leitura
          </div>
        )}
        {podeGravar && (
          <button
            type="button"
            onClick={() => setPadronizarAberto(true)}
            className="rounded-lg border border-line bg-card px-3.5 py-1.5 text-[13px] font-semibold text-navy-800 shadow-card hover:bg-surface"
          >
            Padronizar ocorrências
          </button>
        )}
        {podeGravar && (
          <button
            type="button"
            onClick={() => setImportarAberto(true)}
            className="flex items-center gap-1.5 rounded-lg border border-line bg-card px-3.5 py-1.5 text-[13px] font-semibold text-navy-800 shadow-card hover:bg-surface"
          >
            <IconImportar size={14} />
            Importar
          </button>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
          <Kpi rotulo="Boletins" valor={boletins.toLocaleString("pt-BR")} />
          <Kpi rotulo="Linhas lançadas" valor={total.toLocaleString("pt-BR")} />
          <Kpi rotulo="Área (ha)" valor={fmtHa(areaHa)} />
          <Kpi rotulo="Rodadas" valor={String(opcoes?.rodadas.length ?? 0)} />
        </div>

        <div className="overflow-hidden rounded-xl2 border border-line bg-card shadow-card">
          <div className="flex flex-wrap items-center gap-2.5 border-b border-line bg-surface px-4 py-2.5">
            <h2 className="mr-1 text-[14px] font-bold text-ink">Levantamento de campo</h2>
            <select value={rod} onChange={(e) => mudar(() => setRod(e.target.value))} className={FILTRO} aria-label="Rodada">
              <option value="">Todas as rodadas</option>
              {opcoes?.rodadas.map((r) => (
                <option key={r} value={r}>
                  Rodada {r}
                </option>
              ))}
            </select>
            <select value={reg} onChange={(e) => mudar(() => setReg(e.target.value))} className={FILTRO} aria-label="Região">
              <option value="">Todas as regiões</option>
              {opcoes?.regioes.map((r) => (
                <option key={r} value={r}>
                  Região {r}
                </option>
              ))}
            </select>
            <select value={sem} onChange={(e) => mudar(() => setSem(e.target.value))} className={FILTRO} aria-label="Semana">
              <option value="">Todas as semanas</option>
              {opcoes?.semanas.map((s) => (
                <option key={s} value={s}>
                  Semana {s}
                </option>
              ))}
            </select>
            <select value={ori} onChange={(e) => mudar(() => setOri(e.target.value))} className={FILTRO} aria-label="Origem">
              <option value="">Todas as origens</option>
              <option value="apontamento">Apontamento</option>
              <option value="importacao">Importação</option>
            </select>
            <input
              value={busca}
              onChange={(e) => setBusca(e.target.value)}
              placeholder="Buscar fazenda, ocorrência, boletim…"
              className={`${FILTRO} min-w-[240px]`}
            />
          </div>

          {erro && <p className="px-4 py-3 text-[12.5px] font-medium text-alert-600">{erro}</p>}

          <div className="overflow-x-auto">
            <table className="w-full text-[12px]">
              <thead>
                <tr className="border-b border-line bg-navy-900 text-left text-white">
                  <th className="px-3 py-2 text-right font-semibold">Boletim</th>
                  <th className="px-3 py-2 text-right font-semibold">Rodada</th>
                  <th className="px-3 py-2 font-semibold">Data</th>
                  <th className="px-3 py-2 text-right font-semibold">Semana</th>
                  <th className="px-3 py-2 font-semibold">Região</th>
                  <th className="px-3 py-2 font-semibold">Fazenda</th>
                  <th className="px-3 py-2 text-center font-semibold">Talhão</th>
                  <th className="px-3 py-2 text-right font-semibold">Área (ha)</th>
                  <th className="px-3 py-2 font-semibold">Ocorrência</th>
                  <th className="px-3 py-2 font-semibold">Presença</th>
                  <th className="px-3 py-2 font-semibold">Nível</th>
                  <th className="px-3 py-2 font-semibold">Prioridade</th>
                  <th className="px-3 py-2 font-semibold">Recomendação / Diagnóstico</th>
                  <th className="px-3 py-2 font-semibold">Responsável</th>
                  <th className="px-3 py-2 font-semibold">Origem</th>
                  <th className="px-3 py-2 font-semibold">Lançado por</th>
                  <th className="px-3 py-2 font-semibold">Atividade</th>
                  <th className="px-3 py-2 text-center font-semibold">Executado</th>
                </tr>
              </thead>
              <tbody>
                {linhas.map((l, i) => (
                  <tr key={`${l.bol}-${i}`} className={`border-b border-line/60 ${i % 2 === 1 ? "bg-surface" : "bg-card"}`}>
                    <td className="px-3 py-1 text-right tabular text-ink">{l.bol}</td>
                    <td className="px-3 py-1 text-right tabular text-ink">{l.rod}</td>
                    <td className="whitespace-nowrap px-3 py-1 text-ink">{fmtDateBR(l.dt)}</td>
                    <td className="px-3 py-1 text-right tabular text-ink">{l.sem || ""}</td>
                    <td className="whitespace-nowrap px-3 py-1 text-ink">{l.reg ? (l.regNm ? `${l.reg} · ${l.regNm}` : l.reg) : ""}</td>
                    <td className="px-3 py-1 text-ink">{l.fazNm ? `${l.faz} · ${l.fazNm}` : l.faz}</td>
                    <td className="px-3 py-1 text-center text-ink">{l.tlh}</td>
                    <td className="px-3 py-1 text-right tabular text-ink">{l.area !== null ? fmtHa(l.area) : ""}</td>
                    <td className="min-w-[200px] px-3 py-1 text-ink">{l.ocorrencia}</td>
                    <td className="px-3 py-1 text-ink">{l.presenca}</td>
                    <td className="px-3 py-1 text-ink">{l.nivel}</td>
                    <td className="px-3 py-1 text-ink">{l.prioridade}</td>
                    <td className="min-w-[240px] px-3 py-1 text-ink">{l.rec}</td>
                    <td className="whitespace-nowrap px-3 py-1 text-ink">{l.resp}</td>
                    <td className="whitespace-nowrap px-3 py-1 text-ink">{l.origem}</td>
                    <td className="whitespace-nowrap px-3 py-1 text-ink">{l.lancadoPor}</td>
                    <td className="min-w-[160px] px-3 py-1 text-ink">{l.atividade}</td>
                    <td className="px-3 py-1 text-center text-ink">{l.executado}</td>
                  </tr>
                ))}
                {!carregando && linhas.length === 0 && (
                  <tr>
                    <td colSpan={18} className="px-4 py-10 text-center text-muted">
                      {podeGravar
                        ? 'Nenhum levantamento ainda. Use "Importar" para carregar a planilha ou lance pelo Apontamento.'
                        : "Nenhum levantamento ainda."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between border-t border-line bg-surface px-4 py-2 text-[12.5px] text-muted">
            <span>{carregando ? "Carregando…" : `Página ${pagina} de ${totalPaginas} · ${total.toLocaleString("pt-BR")} linha(s)`}</span>
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

      {padronizarAberto && (
        <PadronizarModal
          onFechar={() => {
            setPadronizarAberto(false);
            carregar(true);
          }}
        />
      )}
      {importarAberto && (
        <ImportarModal
          onFechar={() => {
            setImportarAberto(false);
            carregar(true);
          }}
        />
      )}
    </div>
  );
}

interface Previa {
  linhas: number;
  textos: number;
  completas: number;
  parciais: number;
  soOutros: number;
  semOcorrencia: number;
  exemplos: { texto: string; linhas: number; itens: string[]; outros: string }[];
  sobras: { texto: string; linhas: number }[];
}

/** Converte o texto livre das ocorrências importadas para os itens do Cadastro de Ocorrências (com prévia). */
function PadronizarModal({ onFechar }: { onFechar: () => void }) {
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aplicando, setAplicando] = useState(false);
  const [feito, setFeito] = useState<{ linhas: number; textos: number } | null>(null);

  useEffect(() => {
    fetch("/api/rodadas/padronizar-ocorrencias", { cache: "no-store" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => (ok ? setPrevia(j) : setErro(j.error ?? "Não foi possível montar a prévia.")))
      .catch(() => setErro("Não foi possível montar a prévia."));
  }, []);

  async function aplicar() {
    setAplicando(true);
    setErro(null);
    try {
      const res = await fetch("/api/rodadas/padronizar-ocorrencias", { method: "POST" });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Não foi possível padronizar.");
      setFeito({ linhas: j.linhas, textos: j.textos });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível padronizar.");
    } finally {
      setAplicando(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 px-3">
      <div className="flex max-h-[90vh] w-full max-w-4xl flex-col rounded-xl2 bg-card p-4 shadow-pop md:p-5">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-[15px] font-bold text-ink">Padronizar ocorrências importadas</h3>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="px-1 text-[20px] leading-none text-muted">
            ×
          </button>
        </div>
        <p className="mb-3 text-[12.5px] leading-relaxed text-muted">
          Lê o texto de ocorrência das linhas importadas da planilha (ex.: "COLONIÃO E MAMONA") e marca os itens do Cadastro de
          Ocorrências (Colonião, Mamona). O que não for reconhecido vai para <b className="text-ink">Outros</b>. O texto original
          de cada linha é guardado e a conversão pode ser rodada de novo sem repetir o que já foi feito.
        </p>

        {erro && <p className="mb-2 text-[12.5px] font-medium text-alert-600">{erro}</p>}
        {!previa && !erro && <p className="text-[12.5px] text-muted">Analisando as ocorrências importadas…</p>}

        {feito && (
          <p className="mb-2 rounded-lg border border-good-500/30 bg-good-50 px-3 py-2 text-[12.5px] font-semibold text-good-700">
            Pronto: {feito.linhas.toLocaleString("pt-BR")} linha(s) padronizada(s) a partir de {feito.textos.toLocaleString("pt-BR")} texto(s) diferente(s).
          </p>
        )}

        {previa && !feito && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {previa.linhas === 0 ? (
              <p className="text-[12.5px] text-good-700">Nenhuma linha importada pendente: todas já estão padronizadas.</p>
            ) : (
              <>
                <div className="mb-3 grid grid-cols-2 gap-2 md:grid-cols-5">
                  <Num rotulo="Linhas a padronizar" valor={previa.linhas} />
                  <Num rotulo="Tudo reconhecido" valor={previa.completas} />
                  <Num rotulo="Em parte (+ Outros)" valor={previa.parciais} />
                  <Num rotulo="Só em Outros" valor={previa.soOutros} />
                  <Num rotulo="Sem ocorrência" valor={previa.semOcorrencia} />
                </div>
                <p className="mb-1 text-[12px] font-semibold text-ink">Como ficariam os textos mais frequentes</p>
                <div className="overflow-x-auto rounded-md border border-line">
                  <table className="w-full text-[12px]">
                    <thead>
                      <tr className="border-b border-line bg-navy-900 text-left text-white">
                        <th className="px-3 py-1.5 text-right font-semibold">Linhas</th>
                        <th className="px-3 py-1.5 font-semibold">Texto importado</th>
                        <th className="px-3 py-1.5 font-semibold">Itens do cadastro</th>
                        <th className="px-3 py-1.5 font-semibold">Outros</th>
                      </tr>
                    </thead>
                    <tbody>
                      {previa.exemplos.map((x, i) => (
                        <tr key={i} className={`border-b border-line/60 align-top ${i % 2 === 1 ? "bg-surface" : "bg-card"}`}>
                          <td className="px-3 py-1 text-right tabular text-ink">{x.linhas}</td>
                          <td className="min-w-[200px] px-3 py-1 text-ink">{x.texto.length > 90 ? `${x.texto.slice(0, 90)}…` : x.texto}</td>
                          <td className="min-w-[200px] px-3 py-1 text-ink">{x.itens.length ? x.itens.join(", ") : <span className="text-muted">—</span>}</td>
                          <td className="px-3 py-1 text-ink">{x.outros}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {previa.sobras.length > 0 && (
                  <>
                    <p className="mb-1 mt-3 text-[12px] font-semibold text-ink">O que ficaria em Outros (candidatos a novos itens do cadastro)</p>
                    <p className="text-[12px] text-muted">{previa.sobras.map((x) => `${x.texto} (${x.linhas})`).join(" · ")}</p>
                  </>
                )}
              </>
            )}
          </div>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <button type="button" onClick={onFechar} className="rounded-lg border border-line px-4 py-2 text-[13px] font-semibold text-ink">
            {feito ? "Fechar" : "Cancelar"}
          </button>
          {previa && previa.linhas > 0 && !feito && (
            <button
              type="button"
              onClick={aplicar}
              disabled={aplicando}
              className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
            >
              {aplicando ? "Padronizando…" : `Padronizar ${previa.linhas.toLocaleString("pt-BR")} linha(s)`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Num({ rotulo, valor }: { rotulo: string; valor: number }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <div className="text-[10.5px] font-semibold uppercase tracking-wide text-muted">{rotulo}</div>
      <div className="text-[17px] font-extrabold tabular text-navy-900">{valor.toLocaleString("pt-BR")}</div>
    </div>
  );
}

function Kpi({ rotulo, valor }: { rotulo: string; valor: string }) {
  return (
    <div className="rounded-xl2 border border-line bg-card px-4 py-3 shadow-card">
      <div className="text-[11px] font-semibold uppercase tracking-wide text-muted">{rotulo}</div>
      <div className="mt-0.5 text-[20px] font-extrabold tabular text-navy-900">{valor}</div>
    </div>
  );
}

interface ResultadoImportacao {
  lidas: number;
  boletins: number;
  itens: number;
  jaImportados: number;
  rodadasCriadas: number[];
  primeiroBoletim: number | null;
  ultimoBoletim: number | null;
  avisos: string[];
}

function ImportarModal({ onFechar }: { onFechar: () => void }) {
  const [arquivos, setArquivos] = useState<File[]>([]);
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resultado, setResultado] = useState<ResultadoImportacao | null>(null);

  async function enviar() {
    setEnviando(true);
    setErro(null);
    setResultado(null);
    try {
      const form = new FormData();
      arquivos.forEach((f) => form.append("arquivo", f));
      const res = await fetch("/api/rodadas/importar", { method: "POST", body: form });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Não foi possível importar.");
      setResultado(json);
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível importar.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <ModalShell titulo="Importar levantamento de campo" onFechar={onFechar}>
      <p className="mb-4 text-[12.5px] leading-relaxed text-muted">
        Envie a planilha <b className="text-ink">Acompanhamento de Levantamento de Área</b> (aba Base_Campo, até 10
        arquivos). A coluna <b className="text-ink">Status</b> é desconsiderada. As linhas são ordenadas por Rodada,
        Data, Região, Semana e Fazenda e cada combinação vira um boletim, numerado a partir do último + 1. Boletins já
        importados (mesma rodada, data, região, semana e fazenda) não são duplicados.
      </p>
      <Campo label="Planilha (.xlsx)">
        <input
          type="file"
          multiple
          accept=".xlsx,.xls"
          onChange={(e) => setArquivos(Array.from(e.target.files ?? []).slice(0, 10))}
          className="block w-full text-[12.5px] text-ink file:mr-3 file:rounded-md file:border-0 file:bg-navy-900 file:px-3 file:py-1.5 file:text-[12.5px] file:font-semibold file:text-white"
        />
      </Campo>
      {erro && (
        <div className="mt-3 rounded-lg border border-alert-500/30 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-600">{erro}</div>
      )}
      {resultado && (
        <div className="mt-3 rounded-lg border border-good-500/30 bg-good-50 px-3 py-2 text-[12.5px] text-good-700">
          <p className="font-semibold">
            {resultado.lidas.toLocaleString("pt-BR")} linha(s) lida(s) · {resultado.boletins.toLocaleString("pt-BR")} boletim(ns) novo(s) ·{" "}
            {resultado.itens.toLocaleString("pt-BR")} linha(s) gravada(s).
          </p>
          {resultado.primeiroBoletim !== null && (
            <p>
              Boletins {resultado.primeiroBoletim} a {resultado.ultimoBoletim}.
            </p>
          )}
          {resultado.rodadasCriadas.length > 0 && <p>Rodadas criadas no cadastro: {resultado.rodadasCriadas.join(", ")}.</p>}
        </div>
      )}
      {resultado && resultado.avisos.length > 0 && (
        <div className="mt-3 max-h-[140px] overflow-y-auto rounded-lg border border-line bg-surface p-2.5 text-[12px] text-muted">
          <ul className="list-disc space-y-0.5 pl-4">
            {resultado.avisos.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" onClick={onFechar} className="rounded-lg border border-line px-4 py-2 text-[13px] font-semibold text-ink">
          {resultado ? "Fechar" : "Cancelar"}
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
