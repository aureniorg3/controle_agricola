"use client";

import { Fragment, useRef, useState } from "react";
import JanelaFormulario, { JanelaConfirmar } from "@/components/janela";
import { fmtDateBR, fmtHa } from "@/lib/format";

const INPUT = "rounded-md border border-line bg-card px-2.5 py-1.5 text-[13px] text-ink focus:border-brand-600 focus:outline-none disabled:bg-surface";
const ROTULO = "mb-1 block text-[11.5px] font-semibold text-muted";
const BOTAO = "rounded-lg border border-line bg-card px-3.5 py-2 text-[13px] font-medium text-navy-800 hover:bg-surface disabled:opacity-50";

/** Situação da ordem na conferência: o que vai acontecer ao lançar. */
function situacao(l) {
  if (l.situacao === "bloqueada") return { rotulo: "Bloqueada", classe: "bg-alert-50 text-alert-700" };
  if (l.situacao === "igual") return { rotulo: l.jaNoDia > 0 ? "Já lançada" : "Sem área nova", classe: "bg-surface text-muted" };
  if (l.mensagens.some((m) => m.nivel === "aviso")) return { rotulo: "Lançar · conferir aviso", classe: "bg-amber-50 text-amber-700" };
  return { rotulo: "Lançar", classe: "bg-good-50 text-good-700" };
}

const COR_MSG = { erro: "text-alert-700", aviso: "text-amber-700", info: "text-muted" };

/**
 * Leitor da mensagem "Planejamento Ordem de Cortes" do WhatsApp: cola a mensagem, confere cada ordem contra o sistema
 * (ordem, frente, fazendas, áreas, o que já está lançado) e mostra a área do dia, o rateio pelos talhões e o boletim de
 * cada uma; só lança depois de confirmar. Abre numa janela pelo botão "Ler mensagem do WhatsApp" da aba; o que foi
 * colado e conferido fica guardado ao fechar. O lançamento manual da área colhida é o "Novo lançamento".
 */
export default function LeitorPlanejamento({ aberto, onFechar, podeGravar, onLancado }) {
  const textoRef = useRef(null);
  const fecharRef = useRef(null);
  const [texto, setTexto] = useState("");
  const [dt, setDt] = useState("");
  const [base, setBase] = useState("saldo");
  const [conf, setConf] = useState(null);
  const [escolhidas, setEscolhidas] = useState(new Set());
  const [abertas, setAbertas] = useState(new Set());
  const [ocupado, setOcupado] = useState(false);
  // gravando o lançamento: a janela não fecha
  const [lancando, setLancando] = useState(false);
  const [confirmar, setConfirmar] = useState(null);
  const [erro, setErro] = useState(null);
  const [resultados, setResultados] = useState(null);
  // só vale a resposta da última conferência pedida (trocas rápidas de data, rateio ou texto)
  const seq = useRef(0);

  /**
   * Confere a mensagem; a conferência guarda o texto, a data e o rateio que foram conferidos — é isso que o Lançar
   * manda. `novo`: primeira conferência de um texto (marca todas as ordens a lançar); nas outras, as desmarcadas ficam.
   */
  async function conferir(opcoes = {}) {
    const pedido = { texto: opcoes.texto ?? texto, dt: opcoes.dt ?? dt, base: opcoes.base ?? base };
    const meu = ++seq.current;
    setOcupado(true);
    setErro(null);
    try {
      const res = await fetch("/api/area-colhida/planejamento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texto: pedido.texto, dt: pedido.dt || undefined, base: pedido.base }),
      });
      const j = await res.json().catch(() => ({}));
      if (meu !== seq.current) return;
      if (!res.ok) throw new Error(j.error ?? "Não foi possível conferir a mensagem.");
      setConf({ ...j, texto: pedido.texto });
      setDt(j.dt ?? "");
      const lancaveis = j.linhas.filter((l) => l.situacao === "lancar").map((l) => l.numero);
      setEscolhidas((antes) => new Set(opcoes.novo ? lancaveis : lancaveis.filter((n) => antes.has(n))));
      if (!opcoes.manterResultados) setResultados(null);
    } catch (e) {
      if (meu !== seq.current) return;
      setErro(e instanceof Error ? e.message : "Não foi possível conferir a mensagem.");
      setConf(null);
    } finally {
      if (meu === seq.current) setOcupado(false);
    }
  }

  /** Pede a confirmação; lança o que está conferido na tela neste momento. */
  function lancar() {
    if (!conf) return;
    const linhas = conf.linhas.filter((l) => escolhidas.has(l.numero) && l.situacao === "lancar");
    if (linhas.length === 0) return;
    const total = linhas.reduce((s, l) => s + (l.areaDia ?? 0), 0);
    // o que vai para o servidor é o que foi conferido (texto, data e rateio da conferência na tela)
    const conferido = { texto: conf.texto, dt: conf.dt, base: conf.base };
    setConfirmar({
      titulo: "Lançar a área colhida?",
      texto: `${linhas.length} ordem(ns) em ${fmtDateBR(conf.dt)} (${fmtHa(total)} ha no total, um boletim por ordem). Fica registrado no Log de Alterações.`,
      botao: "Lançar",
      acao: () => lancarConferido(conferido, linhas),
    });
  }

  async function lancarConferido(conferido, linhas) {
    ++seq.current;
    setOcupado(true);
    setLancando(true);
    setErro(null);
    try {
      const res = await fetch("/api/area-colhida/planejamento", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...conferido, lancar: linhas.map((l) => l.numero) }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Não foi possível lançar.");
      setResultados(j.resultados);
      await onLancado?.();
      // a conferência de novo mostra como ficou (as lançadas passam a "Já lançada")
      await conferir({ ...conferido, manterResultados: true });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível lançar.");
      setOcupado(false);
    } finally {
      setLancando(false);
    }
  }

  const alternarOrdem = (n) =>
    setEscolhidas((s) => {
      const x = new Set(s);
      if (x.has(n)) x.delete(n);
      else x.add(n);
      return x;
    });
  const alternarDetalhe = (n) =>
    setAbertas((s) => {
      const x = new Set(s);
      if (x.has(n)) x.delete(n);
      else x.add(n);
      return x;
    });

  const linhas = conf?.linhas ?? [];
  const aLancar = linhas.filter((l) => l.situacao === "lancar");
  const escolhidasLancar = aLancar.filter((l) => escolhidas.has(l.numero));
  const totalEscolhido = escolhidasLancar.reduce((s, l) => s + (l.areaDia ?? 0), 0);
  const conta = (f) => linhas.filter(f).length;

  return (
    <>
      {/* sem F2 aqui: lançar pede confirmação; Esc fecha a janela (o que foi colado fica) */}
      <JanelaFormulario
        aberto={aberto}
        rotulo="Lançar pela mensagem do WhatsApp"
        titulo="Lançar pela mensagem do WhatsApp"
        subtitulo='Cole o "Planejamento Ordem de Cortes": o sistema confere cada ordem e mostra o que vai lançar antes de gravar · Esc fecha'
        onFechar={onFechar}
        ocupado={lancando}
        // com mensagem já colada, o foco vai para o Fechar: no texto, ele ficaria todo selecionado e uma tecla
        // apagaria a mensagem, a conferência e os resultados
        focoInicial={texto.trim() ? fecharRef : textoRef}
        largura="6xl"
        rodape={
          <>
            {conf && (
              <span className="self-center text-[12.5px] text-muted">
                {escolhidasLancar.length} ordem(ns) marcada(s) · {fmtHa(totalEscolhido)} ha em {fmtDateBR(conf.dt)}
              </span>
            )}
            <button ref={fecharRef} type="button" onClick={onFechar} disabled={lancando} className={BOTAO}>
              Fechar
            </button>
            {conf && (
              <button
                type="button"
                onClick={lancar}
                disabled={!podeGravar || ocupado || escolhidasLancar.length === 0}
                className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white shadow-card hover:bg-navy-800 disabled:opacity-50"
              >
                {ocupado ? "Aguarde…" : `Lançar ${escolhidasLancar.length} ordem(ns)`}
              </button>
            )}
          </>
        }
      >
        <div className="space-y-3">
          <textarea
            ref={textoRef}
            value={texto}
            readOnly={ocupado}
            onChange={(e) => {
              setTexto(e.target.value);
              // mensagem nova: volta a valer a data dela (o dia anterior)
              setConf(null);
              setDt("");
              setResultados(null);
              ++seq.current;
              setOcupado(false);
            }}
            rows={8}
            placeholder={"*Planejamento Ordem de Cortes*\nData: *14/10/2026*\n*_# Frente I_*\nOrdem. *2496*\nFaz. São João 9845\nÁrea. 227.38\nRealizado. 107.38\nResta. 120.00"}
            className={`${INPUT} w-full font-mono text-[12px] leading-relaxed`}
            aria-label="Mensagem do WhatsApp"
          />
          <div className="flex flex-wrap items-end gap-3">
            <button
              type="button"
              onClick={() => conferir({ novo: true })}
              disabled={!texto.trim() || ocupado}
              className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white shadow-card hover:bg-navy-800 disabled:opacity-50"
            >
              {ocupado && !conf ? "Conferindo…" : "Conferir mensagem"}
            </button>
            <div>
              <label className={ROTULO} title="Em branco: o dia anterior à data da mensagem">
                Data do lançamento
              </label>
              <input
                type="date"
                value={dt}
                onChange={(e) => {
                  setDt(e.target.value);
                  if (e.target.value && texto.trim()) conferir({ dt: e.target.value, novo: !conf });
                }}
                className={`${INPUT} w-[160px]`}
                aria-label="Data do lançamento (em branco, o dia anterior ao da mensagem)"
              />
            </div>
            {conf && (
              <>
                <div>
                  <label className={ROTULO}>Ratear proporcional ao</label>
                  <select
                    value={base}
                    onChange={(e) => {
                      setBase(e.target.value);
                      conferir({ base: e.target.value });
                    }}
                    className={`${INPUT} w-[210px]`}
                  >
                    <option value="saldo">Saldo a colher de cada talhão</option>
                    <option value="area">Área de cada talhão</option>
                  </select>
                </div>
                <p className="pb-2 text-[12px] text-muted">
                  {conf.data ? `Mensagem de ${fmtDateBR(conf.data)} · ` : ""}
                  {linhas.length} ordem(ns) · lança em {fmtDateBR(conf.dt)}
                  {conf.data && conf.dt !== conf.data ? " (o Realizado da manhã vale até o dia anterior)" : ""}
                </p>
              </>
            )}
          </div>

          {erro && <p className="rounded-md border border-alert-500/40 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-700">{erro}</p>}
          {conf?.avisos?.length > 0 && (
            <ul className="list-disc pl-5 text-[12px] text-amber-700">
              {conf.avisos.map((a) => (
                <li key={a}>{a}</li>
              ))}
            </ul>
          )}

          {conf && (
            <>
              <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12.5px] text-muted">
                <span>
                  <b className="tabular text-good-700">{aLancar.length}</b> a lançar
                </span>
                <span>
                  <b className="tabular text-amber-700">{conta((l) => l.situacao === "lancar" && l.mensagens.some((m) => m.nivel === "aviso"))}</b> com aviso
                </span>
                <span>
                  <b className="tabular text-ink">{conta((l) => l.situacao === "igual")}</b> sem área nova
                </span>
                <span>
                  <b className="tabular text-alert-700">{conta((l) => l.situacao === "bloqueada")}</b> bloqueada(s)
                </span>
              </div>

              <div className="overflow-x-auto rounded-lg border border-line bg-card">
                <table className="w-full text-[12.5px]" data-sem-ordenar>
                  <thead>
                    <tr className="border-b border-line bg-surface text-left text-muted">
                      <th className="w-8 px-2 py-1.5" />
                      <th className="w-6 px-1 py-1.5" />
                      <th className="px-3 py-1.5 font-medium">Frente</th>
                      <th className="px-3 py-1.5 text-right font-medium">Ordem</th>
                      <th className="min-w-[180px] px-3 py-1.5 font-medium">Fazenda</th>
                      <th className="px-3 py-1.5 text-right font-medium">Área (ha)</th>
                      <th className="px-3 py-1.5 text-right font-medium">Realizado (ha)</th>
                      <th className="px-3 py-1.5 text-right font-medium">Já lançado (ha)</th>
                      <th className="px-3 py-1.5 text-right font-medium">Área do dia (ha)</th>
                      <th className="px-3 py-1.5 text-right font-medium">Boletim</th>
                      <th className="px-3 py-1.5 font-medium">Situação</th>
                    </tr>
                  </thead>
                  <tbody>
                    {linhas.map((l) => {
                      const s = situacao(l);
                      const ab = abertas.has(l.numero);
                      const pode = l.situacao === "lancar";
                      return (
                        <Fragment key={l.numero}>
                          <tr className={`border-t border-line/60 ${ab ? "bg-[#2E5FA8]/[0.06]" : ""}`}>
                            <td className="px-2 py-1.5 text-center">
                              <input
                                type="checkbox"
                                checked={pode && escolhidas.has(l.numero)}
                                disabled={!pode || !podeGravar}
                                onChange={() => alternarOrdem(l.numero)}
                                aria-label={`Lançar a ordem ${l.numero}`}
                              />
                            </td>
                            <td className="cursor-pointer px-1 py-1.5 text-center text-muted" onClick={() => alternarDetalhe(l.numero)} title="Ver a conferência e o rateio">
                              {ab ? "▾" : "▸"}
                            </td>
                            <td className="whitespace-nowrap px-3 py-1.5 text-ink" title={l.frenteSistema ? `No sistema: ${l.frenteSistema}` : undefined}>
                              {l.frenteMensagem || "–"}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular font-semibold text-ink">{l.numero}</td>
                            <td className="px-3 py-1.5 text-ink">
                              {l.fazendasSistema.length > 0 ? l.fazendasSistema.map((f) => `${f.cod} · ${f.nm}`).join(" / ") : l.fazendaTexto}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular text-ink" title={l.areaSistema !== null ? `No sistema: ${fmtHa(l.areaSistema)} ha` : undefined}>
                              {l.areaMensagem !== null ? fmtHa(l.areaMensagem) : "–"}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular text-ink">{l.realizado !== null ? fmtHa(l.realizado) : "–"}</td>
                            <td className="px-3 py-1.5 text-right tabular text-muted">{l.colhidoAnterior !== null ? fmtHa(l.colhidoAnterior) : "–"}</td>
                            <td className={`px-3 py-1.5 text-right tabular font-semibold ${l.areaDia < 0 ? "text-alert-700" : "text-[#4A8A36]"}`}>
                              {l.areaDia !== null ? fmtHa(l.areaDia) : "–"}
                            </td>
                            <td className="px-3 py-1.5 text-right tabular text-ink" title={l.boletimNovo ? "Boletim novo" : l.boletim ? "Boletim já usado nesta ordem e data" : undefined}>
                              {l.boletim ?? "–"}
                            </td>
                            <td className="px-3 py-1.5">
                              <span className={`inline-block whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold ${s.classe}`}>{s.rotulo}</span>
                            </td>
                          </tr>
                          {(ab || l.situacao === "bloqueada" || l.mensagens.some((m) => m.nivel === "aviso")) && l.mensagens.length > 0 && (
                            <tr className="border-t border-line/30">
                              <td colSpan={2} />
                              <td colSpan={9} className="px-3 pb-2 pt-0.5">
                                <ul className="space-y-0.5 text-[11.5px]">
                                  {l.mensagens.map((m) => (
                                    <li key={m.texto} className={COR_MSG[m.nivel]}>
                                      {m.nivel === "erro" ? "✕ " : m.nivel === "aviso" ? "! " : "· "}
                                      {m.texto}
                                    </li>
                                  ))}
                                </ul>
                              </td>
                            </tr>
                          )}
                          {ab && l.talhoes.length > 0 && (
                            <tr className="border-t border-line/30 bg-surface/40">
                              <td colSpan={2} />
                              <td colSpan={9} className="px-3 py-2">
                                <table className="w-full max-w-[720px] text-[12px]" data-sem-ordenar>
                                  <thead>
                                    <tr className="text-left text-muted">
                                      <th className="py-1 pr-3 font-medium">Fazenda</th>
                                      <th className="py-1 pr-3 text-center font-medium">Talhão</th>
                                      <th className="py-1 pr-3 text-right font-medium">Área (ha)</th>
                                      <th className="py-1 pr-3 text-right font-medium">Colhida até o dia anterior</th>
                                      <th className="py-1 pr-3 text-right font-medium">No dia (agora)</th>
                                      <th className="py-1 pr-3 text-right font-medium">No dia (vai lançar)</th>
                                      <th className="py-1 text-right font-medium">Saldo depois</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {l.talhoes.map((t) => (
                                      <tr key={`${t.faz}|${t.tlh}`} className="border-t border-line/40">
                                        <td className="py-1 pr-3 tabular text-ink">{t.faz}</td>
                                        <td className="py-1 pr-3 text-center font-semibold text-ink">{t.tlh}</td>
                                        <td className="py-1 pr-3 text-right tabular text-ink">{fmtHa(t.areaHa)}</td>
                                        <td className="py-1 pr-3 text-right tabular text-muted">{fmtHa(t.anterior)}</td>
                                        <td className="py-1 pr-3 text-right tabular text-muted">{t.diaAtual ? fmtHa(t.diaAtual) : "–"}</td>
                                        <td className={`py-1 pr-3 text-right tabular ${t.dia > 0 ? "font-semibold text-[#4A8A36]" : "text-muted"}`}>
                                          {t.dia > 0 ? fmtHa(t.dia) : "–"}
                                        </td>
                                        <td className="py-1 text-right tabular text-ink">{fmtHa(Math.max(0, t.areaHa - t.anterior - t.dia))}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {conf.foraDaMensagem.length > 0 && (
                <p className="text-[11.5px] text-muted">
                  Ordens abertas no sistema que não vieram na mensagem:{" "}
                  {conf.foraDaMensagem
                    .slice(0, 30)
                    .map((o) => `${o.numero}${o.frente ? ` (${o.frente})` : ""}`)
                    .join(", ")}
                  {conf.foraDaMensagem.length > 30 ? "…" : ""}
                </p>
              )}

              {resultados && (
                <div className="rounded-md border border-line bg-surface px-3 py-2 text-[12.5px]">
                  {resultados.map((r) => (
                    <div key={r.numero} className={r.ok ? "text-good-700" : "text-alert-700"}>
                      Ordem {r.numero}: {r.ok ? `boletim nº ${r.boletim ?? "–"} · ${r.texto}` : r.texto}
                    </div>
                  ))}
                </div>
              )}

              <p className="text-[11.5px] leading-relaxed text-muted">
                Área do dia = Realizado da mensagem − o já lançado até o dia anterior à data do lançamento, rateada entre os talhões da ordem sem passar do
                que falta colher em cada um (como no lançamento manual pela ordem). Se a ordem já tiver lançamento nessa data, ele é substituído. Cada ordem
                recebe um boletim; os ajustes finos continuam no Novo lançamento e no histórico.
              </p>
            </>
          )}
        </div>
      </JanelaFormulario>

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
    </>
  );
}
