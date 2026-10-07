"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { IconAlerta, IconCamadas, IconGrafico, IconOrdemServico, IconRelogio } from "@/components/icons";
import { fmtDateBR } from "@/lib/format";
import type { LinhaGrupoOS, PainelOS } from "@/lib/os-agr";
import { podeEditar } from "@/lib/permissoes";
import type { PerfilUsuario } from "@/lib/types";
import { Barra, Caixa, Indicador, Secao, Vazio, nf } from "@/app/(app)/painel/blocos";
import { BarraFiltrosOS, BotaoImportarOS, paramsDosFiltros, usarFiltrosOS, usarOpcoesOS } from "./comum";

const AZUL = "#2E5FA8";
const VERDE = "#5D9E48";
const LARANJA = "#D77B38";
const VERMELHO = "#BE3132";
const MESES = ["jan", "fev", "mar", "abr", "mai", "jun", "jul", "ago", "set", "out", "nov", "dez"];
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100)}%` : "–");
const int = (n: number) => n.toLocaleString("pt-BR");

export default function PainelOSClient({ perfil }: { perfil: PerfilUsuario }) {
  const [f, setF] = usarFiltrosOS();
  const [versao, setVersao] = useState(0);
  const opcoes = usarOpcoesOS(versao);
  const [d, setD] = useState<(PainelOS & { hoje: string }) | null>(null);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    const p = paramsDosFiltros(f);
    p.set("painel", "1");
    fetch(`/api/os-agricola?${p}`, { cache: "no-store" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ativo) return;
        if (ok) {
          setD(j);
          setErro(null);
        } else setErro(j.error ?? "Não foi possível carregar o painel.");
      })
      .catch(() => ativo && setErro("Não foi possível carregar o painel."))
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
  }, [f, versao]);

  const semBase = opcoes && opcoes.ordens === 0;
  const maxFaixa = Math.max(1, ...(d?.faixas.map((x) => x.ordens) ?? [0]));
  const emAberto = d ? d.abertas + d.liberadas : 0;

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-shrink-0 flex-wrap items-center gap-3 border-b border-line bg-card px-6 py-3">
        <nav className="min-w-0 flex-1 text-[13px] text-muted">
          <span className="text-[11px] uppercase tracking-wide">Ordem de Serviço Agr.</span>
          <div className="truncate text-[15px] font-bold text-ink">Dashboard</div>
        </nav>
        {opcoes?.ultimaImportacao && <span className="text-[12px] text-muted">Base atualizada em {opcoes.ultimaImportacao}</span>}
        {podeEditar(perfil) && <BotaoImportarOS onImportado={() => setVersao((v) => v + 1)} />}
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mb-5 rounded-xl2 border border-line bg-card px-4 py-3 shadow-card">
          <BarraFiltrosOS f={f} setF={setF} opcoes={opcoes} />
        </div>

        {erro && <p className="mb-4 rounded-md border border-alert-500/40 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-700">{erro}</p>}
        {semBase && <Vazio texto='A base de O.S. ainda está vazia. Use "Importar O.S." com o Relatório de Ordens de Serviço das Etapas.' />}

        {d && !semBase && (
          <div className={`space-y-8 transition-opacity ${carregando ? "opacity-60" : ""}`}>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
              <Indicador icone={IconOrdemServico} rotulo="O.S. no filtro" valor={int(d.total)} apoio={`${nf(d.areaRec)} ha recomendados`} />
              <Indicador icone={IconCamadas} rotulo="Em aberto" valor={int(emAberto)} apoio={`${int(d.abertas)} abertas · ${int(d.liberadas)} liberadas`} />
              <Indicador icone={IconGrafico} rotulo="Encerradas" valor={int(d.encerradas)} apoio={`${pct(d.encerradas, d.total)} das O.S.`} />
              <Indicador icone={IconCamadas} rotulo="Área encerrada" valor={nf(d.areaRecEncerrada)} unidade="ha" apoio={`${pct(d.areaRecEncerrada, d.areaRec)} da área recomendada`} />
              <Indicador icone={IconAlerta} rotulo="Previsão vencida" valor={int(d.atrasadas)} apoio="Em aberto com a previsão final antes de hoje" />
              <Indicador
                icone={IconRelogio}
                rotulo="Prazo médio"
                valor={d.mediaDiasEncerrar === null ? "–" : nf(d.mediaDiasEncerrar, 1)}
                unidade="dias"
                apoio="Da data da O.S. ao encerramento"
              />
            </div>

            <div className="grid gap-4 lg:grid-cols-5">
              <Caixa icone={IconRelogio} titulo="O.S. em aberto por faixa de dias" subtitulo={`Dias desde a data da O.S. até hoje (${fmtDateBR(d.hoje)})`} ligacao="/acompanhamentos/os-agricola/faixas-dias" rotuloLigacao="Editar faixas" className="lg:col-span-2">
                {emAberto === 0 ? (
                  <Vazio texto="Nenhuma O.S. em aberto no filtro." />
                ) : (
                  <div className="space-y-3">
                    {d.faixas.map((x, i) => (
                      <Link
                        key={x.descricao}
                        href={`/acompanhamentos/os-agricola/ordens?faixa=${encodeURIComponent(x.descricao)}`}
                        className="group block rounded-md px-1 py-0.5 hover:bg-surface"
                      >
                        <div className="mb-1 flex items-baseline justify-between gap-3 text-[12.5px]">
                          <span className="text-ink group-hover:underline">{x.descricao}</span>
                          <span className="tabular text-ink">
                            {int(x.ordens)} <span className="text-[11px] text-muted">O.S. · {nf(x.areaRec)} ha</span>
                          </span>
                        </div>
                        <Barra valor={x.ordens / maxFaixa} cor={[VERDE, "#D9A21B", LARANJA, VERMELHO][Math.min(i, 3)]} altura={6} />
                      </Link>
                    ))}
                  </div>
                )}
              </Caixa>
              <Caixa icone={IconGrafico} titulo="Emitidas e encerradas por mês" subtitulo="Quantidade de O.S. pela data da O.S. e pela data de encerramento" className="lg:col-span-3">
                <GraficoMeses meses={d.porMes.slice(-12)} />
              </Caixa>
            </div>

            <Secao titulo="Por solicitante" subtitulo="Responsável da O.S., com a área do Cadastro Responsáveis">
              <div className="grid gap-4 2xl:grid-cols-3">
                <div className="min-w-0 2xl:col-span-2">
                  <TabelaGrupo linhas={d.porSolicitante} rotulo="Solicitante" comArea filtro={(l) => ({ resp: l.chave })} setF={(p) => setF({ ...f, ...p })} />
                </div>
                <Caixa titulo="Por área" subtitulo="Somando os solicitantes de cada área">
                  <div className="space-y-3">
                    {d.porArea.map((a) => (
                      <div key={a.chave}>
                        <div className="mb-1 flex items-baseline justify-between gap-3 text-[12.5px]">
                          <span className="truncate text-ink">{a.nome}</span>
                          <span className="tabular flex-shrink-0 text-ink">
                            {int(a.ordens)} <span className="text-[11px] text-muted">O.S. · {pct(a.encerradas, a.ordens)} encerr.</span>
                          </span>
                        </div>
                        <Barra valor={a.ordens / Math.max(1, d.porArea[0]?.ordens ?? 1)} cor={AZUL} altura={5} />
                      </div>
                    ))}
                  </div>
                </Caixa>
              </div>
            </Secao>

            <Secao titulo="Por operação" subtitulo="Operações agrícolas das O.S. (uma O.S. pode ter mais de uma)">
              <TabelaGrupo linhas={d.porOperacao} rotulo="Operação" mostrarCodigo limite={15} />
            </Secao>

            <Secao titulo="Por etapa">
              <TabelaGrupo linhas={d.porEtapa} rotulo="Etapa" mostrarCodigo filtro={(l) => ({ etapa: l.chave })} setF={(p) => setF({ ...f, ...p })} />
            </Secao>

            <p className="text-[11.5px] text-muted">
              Em aberto = posição Aberta ou Liberada. Área = área recomendada total dos talhões da O.S. Previsão vencida = O.S. em aberto com a previsão final
              anterior a hoje. Período e safra filtram pela data e pela safra da O.S.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

function TabelaGrupo({
  linhas,
  rotulo,
  comArea,
  mostrarCodigo,
  limite,
  filtro,
  setF,
}: {
  linhas: LinhaGrupoOS[];
  rotulo: string;
  comArea?: boolean;
  mostrarCodigo?: boolean;
  limite?: number;
  filtro?: (l: LinhaGrupoOS) => { resp?: string; etapa?: string };
  setF?: (p: { resp?: string; etapa?: string }) => void;
}) {
  const [todas, setTodas] = useState(false);
  const vis = limite && !todas ? linhas.slice(0, limite) : linhas;
  const tot = linhas.reduce(
    (a, l) => ({ ordens: a.ordens + l.ordens, aberto: a.aberto + l.abertas + l.liberadas, enc: a.enc + l.encerradas, area: a.area + l.areaRec, atrasadas: a.atrasadas + l.atrasadas }),
    { ordens: 0, aberto: 0, enc: 0, area: 0, atrasadas: 0 }
  );
  if (linhas.length === 0) return <Vazio texto="Nada no filtro." />;
  return (
    <div className="overflow-hidden rounded-xl2 border border-line bg-card shadow-card">
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="border-b border-line bg-surface text-left text-muted">
              <th className="px-3 py-2 font-medium">{rotulo}</th>
              {comArea && <th className="px-3 py-2 font-medium">Área</th>}
              <th className="px-3 py-2 text-right font-medium">O.S.</th>
              <th className="px-3 py-2 text-right font-medium">Em aberto</th>
              <th className="px-3 py-2 text-right font-medium">Prev. vencida</th>
              <th className="px-3 py-2 text-right font-medium">Encerradas</th>
              <th className="min-w-[140px] px-3 py-2 font-medium">% encerrada</th>
              <th className="px-3 py-2 text-right font-medium">Área rec. (ha)</th>
              <th className="px-3 py-2 text-right font-medium">Prazo médio (dias)</th>
            </tr>
          </thead>
          <tbody>
            {vis.map((l) => {
              const p = l.ordens > 0 ? l.encerradas / l.ordens : 0;
              return (
                <tr key={l.chave || "-"} className="border-t border-line/60">
                  <td className="min-w-[200px] px-3 py-1.5 text-ink">
                    {filtro && setF && l.chave ? (
                      <button type="button" onClick={() => setF(filtro(l))} className="text-left hover:underline" title="Filtrar por este item">
                        {mostrarCodigo && l.chave ? <span className="tabular text-muted">{l.chave} · </span> : null}
                        {l.nome}
                      </button>
                    ) : (
                      <>
                        {mostrarCodigo && l.chave ? <span className="tabular text-muted">{l.chave} · </span> : null}
                        {l.nome}
                      </>
                    )}
                  </td>
                  {comArea && <td className="whitespace-nowrap px-3 py-1.5 text-muted">{l.area || "–"}</td>}
                  <td className="px-3 py-1.5 text-right tabular text-ink">{int(l.ordens)}</td>
                  <td className="px-3 py-1.5 text-right tabular text-ink">{l.abertas + l.liberadas ? int(l.abertas + l.liberadas) : "–"}</td>
                  <td className="px-3 py-1.5 text-right tabular" style={{ color: l.atrasadas ? VERMELHO : undefined }}>
                    {l.atrasadas ? int(l.atrasadas) : "–"}
                  </td>
                  <td className="px-3 py-1.5 text-right tabular text-ink">{l.encerradas ? int(l.encerradas) : "–"}</td>
                  <td className="px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <div className="flex-1">
                        <Barra valor={p} cor={p >= 0.9 ? VERDE : p >= 0.6 ? "#D9A21B" : LARANJA} altura={5} />
                      </div>
                      <span className="w-9 text-right tabular text-[11.5px] text-muted">{pct(l.encerradas, l.ordens)}</span>
                    </div>
                  </td>
                  <td className="px-3 py-1.5 text-right tabular text-ink">{nf(l.areaRec)}</td>
                  <td className="px-3 py-1.5 text-right tabular text-ink">{l.mediaDias === null ? "–" : nf(l.mediaDias, 1)}</td>
                </tr>
              );
            })}
            <tr className="border-t border-line bg-surface font-semibold text-ink">
              <td className="px-3 py-1.5" colSpan={comArea ? 2 : 1}>
                Total
              </td>
              <td className="px-3 py-1.5 text-right tabular">{int(tot.ordens)}</td>
              <td className="px-3 py-1.5 text-right tabular">{int(tot.aberto)}</td>
              <td className="px-3 py-1.5 text-right tabular">{int(tot.atrasadas)}</td>
              <td className="px-3 py-1.5 text-right tabular">{int(tot.enc)}</td>
              <td className="px-3 py-1.5 tabular text-[11.5px] text-muted">{pct(tot.enc, tot.ordens)}</td>
              <td className="px-3 py-1.5 text-right tabular">{nf(tot.area)}</td>
              <td className="px-3 py-1.5" />
            </tr>
          </tbody>
        </table>
      </div>
      {limite && linhas.length > limite && (
        <button type="button" onClick={() => setTodas((t) => !t)} className="w-full border-t border-line px-3 py-2 text-[12px] text-muted hover:bg-surface hover:text-ink">
          {todas ? "Mostrar só as 15 maiores" : `Mostrar todas (${linhas.length})`}
        </button>
      )}
    </div>
  );
}

function GraficoMeses({ meses }: { meses: { mes: string; emitidas: number; encerradas: number }[] }) {
  if (meses.length === 0) return <Vazio texto="Sem O.S. no filtro." />;
  const max = Math.max(1, ...meses.flatMap((m) => [m.emitidas, m.encerradas]));
  return (
    <div>
      <div className="flex h-44 items-end gap-2">
        {meses.map((m) => (
          <div key={m.mes} className="flex h-full min-w-0 flex-1 flex-col justify-end">
            <div className="flex flex-1 items-end justify-center gap-[3px]">
              {[
                [m.emitidas, AZUL, "emitidas"],
                [m.encerradas, VERDE, "encerradas"],
              ].map(([v, cor, nome]) => (
                <div key={nome as string} className="flex w-1/2 max-w-[18px] flex-col items-center justify-end" title={`${v} ${nome}`}>
                  <span className="mb-0.5 text-[10px] tabular text-muted">{Number(v) || ""}</span>
                  <div className="w-full rounded-t-[3px]" style={{ height: `${(Number(v) / max) * 120}px`, background: cor as string }} />
                </div>
              ))}
            </div>
            <div className="mt-1.5 border-t border-line pt-1 text-center text-[10.5px] text-muted">
              {MESES[Number(m.mes.slice(5, 7)) - 1]}/{m.mes.slice(2, 4)}
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-4 text-[11.5px] text-muted">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: AZUL }} />
          Emitidas
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: VERDE }} />
          Encerradas
        </span>
      </div>
    </div>
  );
}
