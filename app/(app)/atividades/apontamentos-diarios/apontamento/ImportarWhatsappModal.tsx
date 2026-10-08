"use client";

import { Fragment, useMemo, useState } from "react";
import type { DeParaOperacoes, PreviaWhatsapp } from "@/lib/db-import-whatsapp";
import { fmtDateBR } from "@/lib/format";

const BOTAO = "rounded-lg border border-line bg-card px-3.5 py-1.5 text-[12.5px] font-medium text-navy-800 hover:bg-surface disabled:opacity-40";
const CAMPO = "rounded-md border border-line bg-card px-2.5 py-1.5 text-[12.5px] text-ink focus:border-brand-600 focus:outline-none";
const nf = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const SEM_CODIGO = "__sem";

/**
 * Importação da conversa exportada do WhatsApp (grupo C.A.P.F.O): lê as mensagens de produção, mostra a prévia com a
 * data da operação escrita no texto, a operação de cada atividade (de-para) e os avisos, e grava só os marcados.
 */
export default function ImportarWhatsappModal({ onFechar, onConcluido }: { onFechar: () => void; onConcluido: () => void }) {
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [desde, setDesde] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    return d.toLocaleDateString("sv-SE");
  });
  const [ate, setAte] = useState("");
  const [lendo, setLendo] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [previa, setPrevia] = useState<(PreviaWhatsapp & { mensagens: number; periodo: { de: string; ate: string } }) | null>(null);
  const [dePara, setDePara] = useState<DeParaOperacoes>({});
  const [marcados, setMarcados] = useState<Set<string>>(new Set());
  const [aberta, setAberta] = useState<string | null>(null);
  const [atualizarOperacao, setAtualizarOperacao] = useState(false);
  const [feito, setFeito] = useState<string | null>(null);

  async function ler() {
    if (!arquivo) return;
    setLendo(true);
    setErro(null);
    try {
      const f = new FormData();
      f.append("arquivo", arquivo);
      f.append("desde", desde);
      if (ate) f.append("ate", ate);
      const res = await fetch("/api/atividades/apontamentos/whatsapp", { method: "POST", body: f });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Não foi possível ler a conversa.");
      setPrevia(j);
      setDePara(j.dePara ?? {});
      setMarcados(new Set((j as PreviaWhatsapp).itens.filter((i) => !i.jaImportado).map((i) => i.chave)));
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível ler a conversa.");
    } finally {
      setLendo(false);
    }
  }

  // operação que vai ser gravada: a da mensagem ou da O.S. ficam; as demais seguem o de-para escolhido aqui
  const operacaoDe = (i: PreviaWhatsapp["itens"][number]) => {
    if (i.opOrigem === "mensagem" || i.opOrigem === "os") return { cod: i.opCodFinal, ds: i.opDsFinal, origem: i.opOrigem };
    const d = dePara[i.categoria];
    return d?.cod ? { cod: d.cod, ds: d.ds, origem: "depara" as const } : { cod: "", ds: i.categoria, origem: "" as const };
  };

  const itens = previa?.itens ?? [];
  const novos = itens.filter((i) => !i.jaImportado);
  const selecionados = itens.filter((i) => marcados.has(i.chave));
  const areaSel = selecionados.reduce((s, i) => s + i.area, 0);
  const opcoesOperacao = useMemo(() => previa?.operacoes ?? [], [previa]);

  async function importar() {
    if (!previa) return;
    setGravando(true);
    setErro(null);
    try {
      const res = await fetch("/api/atividades/apontamentos/whatsapp/importar", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          itens: atualizarOperacao ? itens.filter((i) => marcados.has(i.chave) || i.jaImportado) : selecionados,
          dePara,
          atualizarOperacao,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.error ?? "Não foi possível importar.");
      setFeito(
        `${j.novos} apontamento(s) importado(s) (${nf(j.area)} ha)${j.jaImportados ? `; ${j.jaImportados} já estavam no sistema` : ""}${
          j.atualizados ? `; operação refeita em ${j.atualizados} já importado(s)` : ""
        }.`
      );
      onConcluido();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível importar.");
    } finally {
      setGravando(false);
    }
  }

  const alternar = (chave: string) =>
    setMarcados((m) => {
      const n = new Set(m);
      if (n.has(chave)) n.delete(chave);
      else n.add(chave);
      return n;
    });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-3">
      <div className="flex max-h-[94vh] w-full max-w-6xl flex-col rounded-xl2 bg-card shadow-pop">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-3">
          <div>
            <h2 className="text-[15px] font-semibold text-ink">Importar apontamentos do WhatsApp</h2>
            <p className="text-[12px] text-muted">
              Conversa exportada do grupo (Mais › Exportar conversa › sem mídia), em .zip ou .txt. A data é a da operação escrita na mensagem — a produção
              costuma ser enviada à tarde ou no dia seguinte. Mensagem já importada não entra de novo.
            </p>
          </div>
          <button type="button" onClick={onFechar} className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted hover:bg-surface" aria-label="Fechar">
            ×
          </button>
        </div>

        <div className="flex flex-wrap items-end gap-2.5 border-b border-line px-5 py-3">
          <label className="flex flex-col gap-1 text-[11.5px] text-muted">
            Conversa (.zip ou .txt)
            <input type="file" accept=".zip,.txt" onChange={(e) => setArquivo(e.target.files?.[0] ?? null)} className="text-[12.5px] text-ink" />
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] text-muted">
            Operações de
            <input type="date" value={desde} onChange={(e) => setDesde(e.target.value)} className={CAMPO} />
          </label>
          <label className="flex flex-col gap-1 text-[11.5px] text-muted">
            até (opcional)
            <input type="date" value={ate} onChange={(e) => setAte(e.target.value)} className={CAMPO} />
          </label>
          <button type="button" onClick={ler} disabled={!arquivo || lendo} className="rounded-lg bg-navy-900 px-4 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40">
            {lendo ? "Lendo…" : "Ler conversa"}
          </button>
          {previa && (
            <span className="pb-1 text-[12px] text-muted">
              {previa.mensagens.toLocaleString("pt-BR")} mensagens ({fmtDateBR(previa.periodo.de)} a {fmtDateBR(previa.periodo.ate)}) · {itens.length} apontamento(s) lido(s),{" "}
              {novos.length} novo(s)
            </span>
          )}
        </div>

        {erro && <p className="mx-5 mt-3 rounded-md border border-alert-500/40 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-700">{erro}</p>}
        {feito && <p className="mx-5 mt-3 rounded-md border border-good-500/40 bg-good-50 px-3 py-2 text-[12.5px] text-good-700">{feito}</p>}

        {previa && !feito && (
          <div className="flex-1 overflow-y-auto px-5 py-3">
            {previa.categorias.length > 0 && (
              <div className="mb-4">
                <div className="mb-1 text-[12.5px] font-semibold text-ink">Operação de cada atividade</div>
                <p className="mb-2 text-[11.5px] text-muted">
                  Quando a mensagem traz o código da operação ou uma O.S. com uma operação só, vale o dela. Para as demais, escolha a operação de cada atividade
                  (fica lembrado para as próximas importações); sem escolha, o apontamento entra sem código, com o nome da atividade.
                </p>
                <div className="grid gap-1.5 md:grid-cols-2">
                  {previa.categorias.map((c) => (
                    <label key={c.categoria} className="flex items-center gap-2 rounded-md border border-line px-2.5 py-1.5 text-[12px]">
                      <span className="w-44 flex-shrink-0 truncate font-medium text-ink" title={c.categoria}>
                        {c.categoria}
                      </span>
                      <span className="w-28 flex-shrink-0 text-right tabular text-muted">
                        {c.itens} · {nf(c.area)} ha
                      </span>
                      <select
                        value={dePara[c.categoria]?.cod || SEM_CODIGO}
                        onChange={(e) => {
                          const cod = e.target.value;
                          setDePara((d) => {
                            const n = { ...d };
                            if (cod === SEM_CODIGO) n[c.categoria] = { cod: "", ds: "" };
                            else n[c.categoria] = { cod, ds: opcoesOperacao.find((o) => o.cod === cod)?.ds ?? "" };
                            return n;
                          });
                        }}
                        className={`${CAMPO} min-w-0 flex-1 py-1`}
                      >
                        <option value={SEM_CODIGO}>— sem código (nome da atividade)</option>
                        {opcoesOperacao.map((o) => (
                          <option key={o.cod} value={o.cod}>
                            {o.cod} · {o.ds}
                          </option>
                        ))}
                      </select>
                    </label>
                  ))}
                </div>
                {itens.some((i) => i.jaImportado) && (
                  <label className="mt-2 flex items-center gap-2 text-[12px] text-ink">
                    <input type="checkbox" checked={atualizarOperacao} onChange={(e) => setAtualizarOperacao(e.target.checked)} />
                    Refazer a operação dos já importados pelo de-para (só os que ninguém alterou depois)
                  </label>
                )}
              </div>
            )}

            <table className="w-full text-[12px]">
              <thead className="sticky top-0 z-10 bg-card">
                <tr className="border-b border-line text-left text-[11px] text-muted">
                  <th className="py-1.5 pr-2">
                    <input
                      type="checkbox"
                      checked={novos.length > 0 && novos.every((i) => marcados.has(i.chave))}
                      onChange={(e) => setMarcados(e.target.checked ? new Set(novos.map((i) => i.chave)) : new Set())}
                      aria-label="Marcar todos os novos"
                    />
                  </th>
                  <th className="py-1.5 pr-2 font-semibold">Data</th>
                  <th className="py-1.5 pr-2 font-semibold">Atividade · Operação</th>
                  <th className="py-1.5 pr-2 font-semibold">Equipe</th>
                  <th className="py-1.5 pr-2 font-semibold">Fazenda · talhões</th>
                  <th className="py-1.5 pr-2 text-right font-semibold">Área (ha)</th>
                  <th className="py-1.5 pr-2 text-right font-semibold">Calda (L)</th>
                  <th className="py-1.5 font-semibold">Enviado por</th>
                </tr>
              </thead>
              <tbody>
                {itens.map((i) => {
                  const op = operacaoDe(i);
                  const semCadastro = Object.entries(i.fazendas).filter(([, nm]) => !nm).map(([f]) => f);
                  return (
                    <Fragment key={i.chave}>
                      <tr className={`border-b border-line/60 align-top ${i.jaImportado ? "text-muted" : ""}`}>
                        <td className="py-1.5 pr-2">
                          <input type="checkbox" disabled={i.jaImportado} checked={marcados.has(i.chave)} onChange={() => alternar(i.chave)} />
                        </td>
                        <td className="whitespace-nowrap py-1.5 pr-2 tabular">
                          {fmtDateBR(i.dt)}
                          {i.dtDaMensagem && <span className="ml-1 text-amber-600" title="Sem data no texto">*</span>}
                        </td>
                        <td className="py-1.5 pr-2">
                          <div className="font-medium text-ink">{i.categoria}</div>
                          <div className="text-[11px] text-muted">
                            {op.cod ? `${op.cod} · ${op.ds}` : "sem código"}
                            {op.origem === "mensagem" ? " (da mensagem)" : op.origem === "os" ? ` (da O.S. ${i.os[0]})` : ""}
                            {i.os.length > 0 && op.origem !== "os" ? ` · O.S. ${i.os.join(", ")}` : ""}
                          </div>
                        </td>
                        <td className="py-1.5 pr-2 text-[11.5px]">{i.equipe || "–"}</td>
                        <td className="py-1.5 pr-2 text-[11.5px]">
                          {[...new Set(i.talhoes.map((t) => t.faz))].map((f) => (
                            <div key={f}>
                              <span className={`font-medium ${i.fazendas[f] ? "text-ink" : "text-alert-600"}`}>{f}</span>{" "}
                              {i.talhoes
                                .filter((t) => t.faz === f)
                                .map((t) => `${t.tlh ? `T${t.tlh}` : "sem talhão"} ${nf(t.area)}`)
                                .join(" · ")}
                            </div>
                          ))}
                        </td>
                        <td className="py-1.5 pr-2 text-right tabular font-semibold text-ink">{nf(i.area)}</td>
                        <td className="py-1.5 pr-2 text-right tabular">{i.calda !== null ? i.calda.toLocaleString("pt-BR") : "–"}</td>
                        <td className="py-1.5 text-[11.5px]">
                          {i.remetente}
                          <div className="text-muted">
                            {fmtDateBR(i.msgEm.slice(0, 10)).slice(0, 5)} {i.msgEm.slice(11)}
                            <button type="button" onClick={() => setAberta(aberta === i.chave ? null : i.chave)} className="ml-1.5 text-brand-700 hover:underline">
                              {aberta === i.chave ? "ocultar" : "mensagem"}
                            </button>
                          </div>
                        </td>
                      </tr>
                      {(i.avisos.length > 0 || semCadastro.length > 0 || i.jaImportado) && (
                        <tr className="border-b border-line/60">
                          <td />
                          <td colSpan={7} className="pb-1.5 text-[11px]">
                            {i.jaImportado && <span className="mr-2 rounded bg-surface px-1.5 py-0.5 text-muted">já importado</span>}
                            {semCadastro.length > 0 && <span className="mr-2 text-alert-600">Fazenda {semCadastro.join(", ")} fora do Cadastro de Fazenda.</span>}
                            {i.avisos.map((a) => (
                              <span key={a} className="mr-2 text-amber-700">
                                {a}
                              </span>
                            ))}
                          </td>
                        </tr>
                      )}
                      {aberta === i.chave && (
                        <tr className="border-b border-line/60">
                          <td />
                          <td colSpan={7} className="pb-2">
                            <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md bg-surface px-3 py-2 font-sans text-[11.5px] text-ink">{i.texto}</pre>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {itens.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-6 text-center text-muted">
                      Nenhuma mensagem de produção com operação nesse período.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}

        <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-3">
          <span className="text-[12px] text-muted">
            {previa && !feito ? `${selecionados.length} marcado(s) · ${nf(areaSel)} ha · * sem data no texto (dia pela hora da mensagem)` : ""}
          </span>
          <div className="flex gap-2">
            <button type="button" className={BOTAO} onClick={onFechar}>
              {feito ? "Fechar" : "Cancelar"}
            </button>
            {previa && !feito && (
              <button
                type="button"
                onClick={importar}
                disabled={gravando || (selecionados.length === 0 && !atualizarOperacao)}
                className="rounded-lg bg-navy-900 px-4 py-1.5 text-[12.5px] font-medium text-white disabled:opacity-40"
              >
                {gravando ? "Importando…" : `Importar ${selecionados.length} apontamento(s)`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
