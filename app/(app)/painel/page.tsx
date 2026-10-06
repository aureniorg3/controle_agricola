import type { ReactNode } from "react";
import Link from "next/link";
import { dadosPainel } from "@/lib/db-painel";
import { fmtDateBR, fmtHa, fmtT, todayISO } from "@/lib/format";
import { nomeEmpresa } from "@/lib/insumos-saldo";

export const dynamic = "force-dynamic";

const brl = (n: number) => n.toLocaleString("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const nf = (n: number, c = 2) => n.toLocaleString("pt-BR", { minimumFractionDigits: c, maximumFractionDigits: c });
const pct = (a: number, b: number) => (b > 0 ? `${Math.round((a / b) * 100).toLocaleString("pt-BR")}%` : "—");

function Bloco({ titulo, ligacao, rotuloLigacao, children }: { titulo: string; ligacao: string; rotuloLigacao: string; children: ReactNode }) {
  return (
    <section className="rounded-xl2 border border-line bg-card p-5 shadow-card">
      <div className="mb-4 flex items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold text-ink">{titulo}</h2>
        <Link href={ligacao} className="text-[12px] text-muted hover:text-ink">
          {rotuloLigacao}
        </Link>
      </div>
      {children}
    </section>
  );
}

function Numero({ rotulo, valor, apoio, tom }: { rotulo: string; valor: string; apoio?: string; tom?: "bom" | "ruim" }) {
  return (
    <div className="min-w-0">
      <div className="text-[12px] text-muted">{rotulo}</div>
      <div className={`tabular text-[22px] font-semibold leading-tight tracking-tight ${tom === "bom" ? "text-good-600" : tom === "ruim" ? "text-alert-600" : "text-ink"}`}>{valor}</div>
      {apoio && <div className="mt-0.5 text-[11.5px] text-muted">{apoio}</div>}
    </div>
  );
}

function Vazio({ texto }: { texto: string }) {
  return <p className="rounded-lg border border-dashed border-line px-4 py-6 text-center text-[12.5px] text-muted">{texto}</p>;
}

/** Barras finas verticais (uma por dia), em SVG: o dia mais recente em verde, os demais em azul-marinho claro. */
function SerieDiaria({ serie }: { serie: { dt: string; ton: number }[] }) {
  if (serie.length === 0) return null;
  const max = Math.max(...serie.map((s) => s.ton), 1);
  const W = 520;
  const H = 90;
  const largura = W / serie.length;
  return (
    <svg viewBox={`0 0 ${W} ${H + 16}`} className="h-auto w-full" role="img" aria-label="Entrada de cana por dia, últimos 30 dias">
      <line x1="0" y1={H} x2={W} y2={H} stroke="currentColor" strokeOpacity="0.15" />
      {serie.map((s, i) => {
        const h = Math.max(1.5, (s.ton / max) * (H - 6));
        const ultimo = i === serie.length - 1;
        return (
          <rect key={s.dt} x={i * largura + largura * 0.2} y={H - h} width={largura * 0.6} height={h} rx="1.5" fill={ultimo ? "#2D8A5A" : "#7C93BD"} opacity={ultimo ? 1 : 0.75}>
            <title>{`${fmtDateBR(s.dt)}: ${fmtT(s.ton)} t`}</title>
          </rect>
        );
      })}
      <text x="0" y={H + 12} fontSize="9" fill="currentColor" opacity="0.55">
        {fmtDateBR(serie[0].dt).slice(0, 5)}
      </text>
      <text x={W} y={H + 12} fontSize="9" fill="currentColor" opacity="0.55" textAnchor="end">
        {fmtDateBR(serie[serie.length - 1].dt).slice(0, 5)}
      </text>
    </svg>
  );
}

function ParBarras({ rotulo, a, b, rotuloA, rotuloB, formato }: { rotulo: string; a: number | null; b: number | null; rotuloA: string; rotuloB: string; formato: (n: number) => string }) {
  const max = Math.max(a ?? 0, b ?? 0, 1);
  const linha = (nome: string, v: number | null, cor: string) => (
    <div className="flex items-center gap-3">
      <span className="w-[68px] flex-shrink-0 text-[11.5px] text-muted">{nome}</span>
      <div className="h-2 flex-1 rounded-full bg-surface">
        <div className="h-2 rounded-full" style={{ width: `${v === null ? 0 : Math.max(2, (v / max) * 100)}%`, background: cor }} />
      </div>
      <span className="tabular w-[84px] flex-shrink-0 text-right text-[12px] text-ink">{v === null ? "—" : formato(v)}</span>
    </div>
  );
  return (
    <div className="space-y-1.5">
      <div className="text-[12.5px] font-medium text-ink">{rotulo}</div>
      {linha(rotuloA, a, "#7C93BD")}
      {linha(rotuloB, b, "#2D8A5A")}
    </div>
  );
}

export default async function Page() {
  const hoje = todayISO();
  const d = await dadosPainel(hoje);
  const { cana, insumos, rodadas, safraComparativo } = d;
  const atual = safraComparativo.find((s) => s.safra === d.safra.ano) ?? safraComparativo[safraComparativo.length - 1];
  const maxAreaRod = Math.max(1, ...rodadas.porRodada.map((r) => r.areaHa));
  const variacaoDia = cana.diaAnteriorT > 0 ? ((cana.diaT - cana.diaAnteriorT) / cana.diaAnteriorT) * 100 : null;

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-shrink-0 items-center gap-3 border-b border-line bg-card px-6 py-3">
        <nav className="min-w-0 flex-1">
          <div className="text-[12px] text-muted">Início</div>
          <div className="truncate text-[15px] font-semibold text-ink">Painel da safra {d.safra.rotulo}</div>
        </nav>
        <span className="hidden text-[12px] text-muted sm:block">Capinópolis-MG · dados importados até {cana.ultimaData ? fmtDateBR(cana.ultimaData) : "—"}</span>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-6">
        <div className="mx-auto grid max-w-[1200px] gap-5 lg:grid-cols-2">
          {/* Entrada de cana */}
          <div className="lg:col-span-2">
            <Bloco titulo="Entrada de cana" ligacao="/acompanhamentos/ordens-de-corte" rotuloLigacao="Ver ordens de corte">
              {cana.ultimaData ? (
                <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
                  <div className="space-y-5">
                    <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                      <Numero
                        rotulo={`Dia ${fmtDateBR(cana.ultimaData).slice(0, 5)}`}
                        valor={`${fmtT(cana.diaT)} t`}
                        apoio={variacaoDia === null ? undefined : `${variacaoDia >= 0 ? "+" : ""}${nf(variacaoDia, 1)}% sobre o dia anterior`}
                        tom={variacaoDia === null ? undefined : variacaoDia >= 0 ? "bom" : "ruim"}
                      />
                      <Numero rotulo="Mês" valor={`${fmtT(cana.mesT)} t`} />
                      <Numero rotulo="Safra" valor={`${fmtT(cana.safraT)} t`} apoio={`${cana.diasEfetivos} dias com entrega`} />
                      <Numero rotulo="Média por dia efetivo" valor={`${fmtT(cana.mediaDiaEfetivoT)} t`} />
                    </div>
                    <div className="text-muted">
                      <SerieDiaria serie={cana.serie} />
                    </div>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-[12.5px]">
                      <thead>
                        <tr className="text-left text-muted">
                          <th className="pb-2 font-medium">Frente</th>
                          <th className="pb-2 text-right font-medium">Dia</th>
                          <th className="pb-2 text-right font-medium">Mês</th>
                          <th className="pb-2 text-right font-medium">Safra</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cana.porFrente.map((f) => (
                          <tr key={f.frente} className="border-t border-line">
                            <td className="py-1.5 text-ink">{f.frente}</td>
                            <td className="tabular py-1.5 text-right">{f.diaT > 0 ? fmtT(f.diaT) : "—"}</td>
                            <td className="tabular py-1.5 text-right">{fmtT(f.mesT)}</td>
                            <td className="tabular py-1.5 text-right font-medium">{fmtT(f.safraT)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <Vazio texto="Nenhuma entrada de cana importada ainda. Importe a pesagem em Ordens de Corte." />
              )}
            </Bloco>
          </div>

          {/* Comparativo de safra */}
          <Bloco titulo="Safra: estimado e realizado" ligacao="/acompanhamentos/colheita/historico-safras" rotuloLigacao="Ver histórico de safras">
            {safraComparativo.length > 0 ? (
              <div className="space-y-5">
                {atual && (
                  <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                    <Numero rotulo="Produção estimada" valor={`${fmtT(atual.estimadoT)} t`} apoio={`Safra ${atual.safra}`} />
                    <Numero
                      rotulo="Entrada de cana até agora"
                      valor={`${fmtT(d.realizadoAteHojeT)} t`}
                      apoio={atual.estimadoT > 0 ? `${pct(d.realizadoAteHojeT, atual.estimadoT)} do estimado` : undefined}
                    />
                    <Numero rotulo="TCH estimado" valor={atual.tchEstimado === null ? "—" : nf(atual.tchEstimado)} />
                    <Numero
                      rotulo="TCH realizado"
                      valor={atual.tchRealizado === null ? "—" : nf(atual.tchRealizado)}
                      tom={atual.tchRealizado !== null && atual.tchEstimado !== null ? (atual.tchRealizado >= atual.tchEstimado ? "bom" : "ruim") : undefined}
                    />
                  </div>
                )}
                <div className="space-y-4 border-t border-line pt-4">
                  {safraComparativo.map((s) => (
                    <ParBarras key={s.safra} rotulo={`Safra ${s.safra} · TCH (t/ha)`} a={s.tchEstimado} b={s.tchRealizado} rotuloA="Estimado" rotuloB="Realizado" formato={(n) => nf(n)} />
                  ))}
                </div>
              </div>
            ) : (
              <Vazio texto="Importe a planilha da safra em Ordens de Corte para comparar estimado e realizado." />
            )}
          </Bloco>

          {/* Insumos */}
          <Bloco titulo="Insumos" ligacao="/acompanhamentos/insumos/saldo" rotuloLigacao="Ver saldo de insumos">
            {insumos.dtBase ? (
              <div className="space-y-5">
                <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                  <Numero rotulo="Valor em estoque" valor={brl(insumos.valor)} apoio={`Saldo de ${fmtDateBR(insumos.dtBase)} · depósitos 207 e 401`} />
                  <Numero
                    rotulo="Variação sobre o retrato anterior"
                    valor={insumos.variacao === null ? "—" : `${insumos.variacao >= 0 ? "+" : "−"} ${brl(Math.abs(insumos.variacao))}`}
                    apoio={insumos.dtAnterior ? `vs ${fmtDateBR(insumos.dtAnterior)}` : undefined}
                    tom={insumos.variacao === null ? undefined : insumos.variacao >= 0 ? "bom" : "ruim"}
                  />
                </div>
                <div className="space-y-1.5 border-t border-line pt-4">
                  {insumos.porEmpresa.map((e) => (
                    <div key={e.emp} className="flex items-center justify-between text-[12.5px]">
                      <span className="text-muted">{nomeEmpresa(e.emp)}</span>
                      <span className="tabular text-ink">{brl(e.valor)}</span>
                    </div>
                  ))}
                </div>
                <div className="flex items-center justify-between rounded-lg bg-surface px-3 py-2.5 text-[12.5px]">
                  <span className="text-muted">Empréstimos em aberto</span>
                  <Link href="/acompanhamentos/insumos/emprestimos" className="tabular font-medium text-ink hover:underline">
                    {insumos.emprestimosAbertos.n} · {brl(insumos.emprestimosAbertos.valor)}
                  </Link>
                </div>
              </div>
            ) : (
              <Vazio texto="Nenhum saldo de insumos importado ainda." />
            )}
          </Bloco>

          {/* Rodadas */}
          <div className="lg:col-span-2">
            <Bloco titulo="Rodadas de campo" ligacao="/rodadas-de-campo/resumo" rotuloLigacao="Ver resumo das rodadas">
              {rodadas.porRodada.length > 0 ? (
                <div className="space-y-2.5">
                  {rodadas.porRodada.map((r) => (
                    <div key={r.rod} className="flex items-center gap-3">
                      <span className="w-[72px] flex-shrink-0 text-[12.5px] text-ink">Rodada {r.rod}</span>
                      <div className="h-2 flex-1 rounded-full bg-surface">
                        <div className="h-2 rounded-full bg-[#2D8A5A]" style={{ width: `${Math.max(2, (r.areaHa / maxAreaRod) * 100)}%` }} />
                      </div>
                      <span className="tabular w-[110px] flex-shrink-0 text-right text-[12.5px] text-ink">{fmtHa(r.areaHa)} ha</span>
                      <span className="hidden w-[150px] flex-shrink-0 text-right text-[11.5px] text-muted sm:block">
                        {r.boletins} boletim(ns){r.ultimaData ? ` · até ${fmtDateBR(r.ultimaData).slice(0, 5)}` : ""}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <Vazio texto="Nenhum boletim de rodada lançado ainda." />
              )}
            </Bloco>
          </div>
        </div>
      </div>
    </div>
  );
}
