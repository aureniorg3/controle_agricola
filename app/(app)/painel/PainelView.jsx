import {
  IconBalanca,
  IconCalendario,
  IconCamadas,
  IconCaminhaoCana,
  IconCifrao,
  IconColhedora,
  IconGota,
  IconGrafico,
  IconMeta,
  IconRodadas,
  IconTrocar,
  IconUsina,
} from "@/components/icons";
import { CabecalhoPagina, CorpoPagina, Pagina } from "@/components/pagina";

import { fmtDateBR, fmtHa, fmtT } from "@/lib/format";
import { nomeEmpresa, textoDosagem, textoHectares } from "@/lib/insumos-saldo";
import {
  Barra,
  Caixa,
  CartaoFrente,
  GraficoDiario,
  GraficoMensal,
  Indicador,
  Legenda,
  Numero,
  Secao,
  Vazio,
  brl,
  compacto,
  coresDasFrentes,
  nf,
} from "./blocos";

const COR_EMPRESA = { 5: "#3B5BA9", 6: "#D77B38" };
const VERDE = "#2D8A5A";
const VERMELHO = "#C94A37";
const dm = (iso) => fmtDateBR(iso).slice(0, 5);
const pct = (a, b) => (b > 0 ? `${Math.round((a / b) * 100).toLocaleString("pt-BR")}%` : "—");
/** "ADUBOS" → "Adubos" (os nomes de grupo vêm em caixa alta do ERP) */
const frase = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s);

function ParBarras({ rotulo, a, b, formato }) {
  const max = Math.max(a ?? 0, b ?? 0, 1);
  const linha = (nome, v, cor) => (
    <div className="flex items-center gap-3">
      <span className="w-[64px] flex-shrink-0 text-[11.5px] text-muted">{nome}</span>
      <div className="flex-1">
        <Barra valor={v === null ? 0 : Math.max(0.02, v / max)} cor={cor} altura={6} />
      </div>
      <span className="tabular w-[72px] flex-shrink-0 text-right text-[12px] text-ink">{v === null ? "—" : formato(v)}</span>
    </div>
  );
  return (
    <div className="space-y-1.5">
      <div className="text-[12.5px] font-medium text-ink">{rotulo}</div>
      {linha("Estimado", a, "#7C93BD")}
      {linha("Realizado", b, VERDE)}
    </div>
  );
}

/** Tela do painel: só apresenta os dados já carregados (a consulta fica em page.jsx). */
export default function PainelView({ d, verEmprestimos }) {
  const { cana, insumos, rodadas, safraComparativo } = d;

  const frentes = cana.porFrente.map((f) => f.frente);
  const cores = coresDasFrentes(frentes);
  const atual = safraComparativo.find((s) => s.safra === d.safra.ano) ?? safraComparativo[safraComparativo.length - 1];
  const maxAreaRod = Math.max(1, ...rodadas.porRodada.map((r) => r.areaHa));

  // moagem do dia e dispersão dos últimos 30 dias
  const varDia = cana.diaAnteriorT > 0 ? (cana.diaT - cana.diaAnteriorT) / cana.diaAnteriorT : null;
  const mesAtual = cana.mensal[cana.mensal.length - 1];
  const comEntrega = cana.diario.filter((x) => x.total > 0);
  const primeiroComEntrega = cana.diario.findIndex((x) => x.total > 0);
  const semEntrega = primeiroComEntrega < 0 ? 0 : cana.diario.slice(primeiroComEntrega).filter((x) => x.total === 0).length;
  const melhor = comEntrega.reduce((m, x) => (!m || x.total > m.total ? x : m), null);
  const menor = comEntrega.reduce((m, x) => (!m || x.total < m.total ? x : m), null);
  const media30 = comEntrega.length ? comEntrega.reduce((a, x) => a + x.total, 0) / comEntrega.length : 0;

  const maxGrupo = Math.max(1, ...insumos.grupos.map((g) => g.valor));
  const maxHa = Math.max(1, ...insumos.capacidade.map((c) => c.hDe));

  return (
    <Pagina>
      <CabecalhoPagina
        titulo={`Painel da safra ${d.safra.rotulo}`}
        categoria="Início"
        info={<span className="hidden sm:inline">Capinópolis-MG · moagem até {cana.ultimaData ? fmtDateBR(cana.ultimaData) : "—"}</span>}
      />

      <CorpoPagina>
        <div className="space-y-8">
          {/* ------------------------------------------------------------------ Moagem */}
          <Secao
            titulo="Moagem"
            subtitulo={cana.ultimaData ? `Entrada de cana na usina · dados até ${fmtDateBR(cana.ultimaData)}` : "Entrada de cana na usina"}
          >
            {cana.ultimaData ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                  <Indicador
                    icone={IconCaminhaoCana}
                    rotulo={`Moagem do dia ${dm(cana.ultimaData)}`}
                    valor={fmtT(cana.diaT)}
                    unidade="t"
                    real={cana.diaT}
                    meta={cana.metaDiaT}
                    apoio={
                      varDia === null ? undefined : (
                        <>
                          <span style={{ color: varDia >= 0 ? VERDE : VERMELHO }} className="font-medium">
                            {varDia >= 0 ? "▲" : "▼"} {nf(Math.abs(varDia) * 100, 1)}%
                          </span>{" "}
                          sobre o dia anterior ({fmtT(cana.diaAnteriorT)} t)
                        </>
                      )
                    }
                  />
                  <Indicador
                    icone={IconCalendario}
                    rotulo={`Moagem em ${mesAtual?.rotulo ?? "o mês"}`}
                    valor={fmtT(cana.mesT)}
                    unidade="t"
                    real={cana.mesT}
                    meta={cana.metaMesT}
                    apoio={mesAtual ? `${mesAtual.dias} dias com entrega · média ${fmtT(mesAtual.mediaDiaT)} t/dia` : undefined}
                  />
                  <Indicador
                    icone={IconUsina}
                    rotulo="Moagem da safra"
                    valor={fmtT(cana.safraT)}
                    unidade="t"
                    real={cana.safraT}
                    meta={cana.metaSafraT}
                    apoio={`${cana.diasEfetivos} dias com entrega desde ${d.safra.inicio ? fmtDateBR(d.safra.inicio) : "o início"}`}
                  />
                  <Indicador
                    icone={IconBalanca}
                    cor="cinza"
                    rotulo="Média por dia efetivo"
                    valor={fmtT(cana.mediaDiaEfetivoT)}
                    unidade="t/dia"
                    apoio={
                      melhor ? (
                        <>
                          Melhor dia dos últimos 30: <span className="tabular text-ink">{fmtT(melhor.total)} t</span> em {dm(melhor.dt)}
                        </>
                      ) : undefined
                    }
                  />
                </div>

                <div className="grid gap-4 xl:grid-cols-[minmax(0,1.65fr)_minmax(0,1fr)]">
                  <Caixa
                    icone={IconGrafico}
                    titulo="Entrada de cana diária"
                    subtitulo="Últimos 30 dias, por frente"
                    ligacao="/acompanhamentos/ordens-de-corte"
                    rotuloLigacao="Ver ordens de corte"
                  >
                    <GraficoDiario dias={cana.diario} frentes={frentes} cores={cores} />
                    <div className="mt-3 space-y-3">
                      <Legenda
                        itens={[
                          ...frentes.map((f) => ({ rotulo: f, cor: cores[f] })),
                          ...(cana.diario.some((x) => x.metaT > 0) ? [{ rotulo: "Meta diária", cor: "#D77B38", tracejado: true }] : []),
                        ]}
                      />
                      <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line pt-3 sm:grid-cols-4">
                        <Numero rotulo="Média nos dias com entrega" valor={`${fmtT(media30)} t`} />
                        <Numero rotulo="Melhor dia" valor={melhor ? `${fmtT(melhor.total)} t` : "—"} apoio={melhor ? dm(melhor.dt) : undefined} />
                        <Numero rotulo="Menor dia com entrega" valor={menor ? `${fmtT(menor.total)} t` : "—"} apoio={menor ? dm(menor.dt) : undefined} />
                        <Numero rotulo="Dias sem entrega" valor={String(semEntrega)} apoio="no período" />
                      </div>
                    </div>
                  </Caixa>

                  <Caixa icone={IconCalendario} titulo="Moagem mensal" subtitulo={`Safra ${d.safra.rotulo}, mês a mês`}>
                    {cana.mensal.length > 0 ? (
                      <>
                        <GraficoMensal meses={cana.mensal} />
                        <div className="mt-3 space-y-3">
                          <Legenda
                            itens={[
                              { rotulo: "Mês fechado", cor: "#3B5BA9" },
                              { rotulo: "Mês em andamento", cor: VERDE },
                              ...(cana.mensal.some((x) => x.metaT !== null) ? [{ rotulo: "Meta do período", cor: "#D77B38" }] : []),
                            ]}
                          />
                          <p className="text-[11.5px] text-muted">Embaixo de cada mês, a média por dia com entrega.</p>
                        </div>
                      </>
                    ) : (
                      <Vazio texto="Sem moagem por mês ainda." />
                    )}
                  </Caixa>
                </div>

                <Caixa icone={IconColhedora} titulo="Moagem por frente" subtitulo="Dia, mês e safra com a meta de cada frente; à direita, os últimos 14 dias">
                  {cana.porFrente.length > 0 ? (
                    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                      {cana.porFrente.map((f) => (
                        <CartaoFrente key={f.frente} f={f} cor={cores[f.frente]} />
                      ))}
                    </div>
                  ) : (
                    <Vazio texto="Nenhuma frente com entrega na safra." />
                  )}
                </Caixa>
              </div>
            ) : (
              <Vazio texto="Nenhuma entrada de cana importada ainda. Importe a pesagem em Ordens de Corte." />
            )}
          </Secao>

          {/* ------------------------------------------------------------------ Safra e campo */}
          <Secao titulo="Safra e campo" subtitulo="Estimado × realizado e rodadas de campo">
            <div className="grid gap-4 xl:grid-cols-2">
              <Caixa
                icone={IconMeta}
                titulo="Safra: estimado e realizado"
                ligacao="/acompanhamentos/colheita/historico-safras"
                rotuloLigacao="Ver histórico de safras"
              >
                {safraComparativo.length > 0 ? (
                  <div className="space-y-5">
                    {atual && (
                      <div className="grid grid-cols-2 gap-x-6 gap-y-4">
                        <Numero rotulo="Produção estimada" valor={`${fmtT(atual.estimadoT)} t`} apoio={`Safra ${atual.safra}`} />
                        <Numero
                          rotulo="Moagem até agora"
                          valor={`${fmtT(d.realizadoAteHojeT)} t`}
                          apoio={atual.estimadoT > 0 ? `${pct(d.realizadoAteHojeT, atual.estimadoT)} do estimado` : undefined}
                        />
                        <Numero rotulo="TCH estimado" valor={atual.tchEstimado === null ? "—" : nf(atual.tchEstimado)} />
                        <Numero
                          rotulo="TCH realizado"
                          valor={atual.tchRealizado === null ? "—" : nf(atual.tchRealizado)}
                          tom={
                            atual.tchRealizado !== null && atual.tchEstimado !== null ? (atual.tchRealizado >= atual.tchEstimado ? "bom" : "ruim") : undefined
                          }
                        />
                      </div>
                    )}
                    <div className="space-y-4 border-t border-line pt-4">
                      {safraComparativo.map((s) => (
                        <ParBarras key={s.safra} rotulo={`Safra ${s.safra} · TCH (t/ha)`} a={s.tchEstimado} b={s.tchRealizado} formato={(n) => nf(n)} />
                      ))}
                    </div>
                  </div>
                ) : (
                  <Vazio texto="Importe a planilha da safra em Ordens de Corte para comparar estimado e realizado." />
                )}
              </Caixa>

              <Caixa
                icone={IconRodadas}
                titulo="Rodadas de campo"
                subtitulo="Área apontada por rodada"
                ligacao="/rodadas-de-campo/resumo"
                rotuloLigacao="Ver resumo das rodadas"
              >
                {rodadas.porRodada.length > 0 ? (
                  <div className="space-y-3">
                    {rodadas.porRodada.map((r) => (
                      <div key={r.rod}>
                        <div className="mb-1 flex items-baseline justify-between gap-3 text-[12.5px]">
                          <span className="text-ink">Rodada {r.rod}</span>
                          <span className="tabular text-ink">{fmtHa(r.areaHa)} ha</span>
                        </div>
                        <Barra valor={Math.max(0.02, r.areaHa / maxAreaRod)} cor={VERDE} altura={5} />
                        <div className="mt-1 text-[11px] text-muted">
                          {r.boletins} boletim(ns){r.ultimaData ? ` · último em ${dm(r.ultimaData)}` : ""}
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <Vazio texto="Nenhum boletim de rodada lançado ainda." />
                )}
              </Caixa>
            </div>
          </Secao>

          {/* ------------------------------------------------------------------ Insumos */}
          <Secao titulo="Insumos" subtitulo={insumos.dtBase ? `Saldo de ${fmtDateBR(insumos.dtBase)} · depósitos 207 e 401` : "Saldo de insumos"}>
            {insumos.dtBase ? (
              <div className="grid gap-4 lg:grid-cols-2 xl:grid-cols-3">
                <div className="flex flex-col gap-4">
                  <Caixa
                    icone={IconCifrao}
                    titulo="Saldo contábil"
                    subtitulo="Valor do estoque (saldo × custo médio)"
                    ligacao="/acompanhamentos/insumos/saldo"
                    rotuloLigacao="Ver saldo de insumos"
                    className={verEmprestimos ? undefined : "flex-1"}
                  >
                    <div className="tabular font-display text-[30px] font-semibold leading-none text-ink">{brl(insumos.valor)}</div>
                    {insumos.variacao !== null && (
                      <div className="mt-2 text-[12px]" style={{ color: insumos.variacao >= 0 ? VERDE : VERMELHO }}>
                        <span className="font-medium">
                          {insumos.variacao >= 0 ? "▲" : "▼"} {brl(Math.abs(insumos.variacao))}
                        </span>{" "}
                        <span className="text-muted">sobre {insumos.dtAnterior ? fmtDateBR(insumos.dtAnterior) : "o retrato anterior"}</span>
                      </div>
                    )}
                    <div className="mt-5 space-y-2.5 border-t border-line pt-4">
                      {insumos.porEmpresa.map((e) => (
                        <div key={e.emp}>
                          <div className="mb-1 flex items-center justify-between text-[12.5px]">
                            <span className="flex items-center gap-2 text-muted">
                              <span className="inline-block h-2.5 w-2.5 rounded-[3px]" style={{ background: COR_EMPRESA[e.emp] ?? "#7C93BD" }} />
                              {nomeEmpresa(e.emp)}
                            </span>
                            <span className="tabular text-ink">{brl(e.valor)}</span>
                          </div>
                          <Barra valor={insumos.valor > 0 ? e.valor / insumos.valor : 0} cor={COR_EMPRESA[e.emp] ?? "#7C93BD"} altura={3} />
                        </div>
                      ))}
                    </div>
                  </Caixa>

                  {verEmprestimos && (
                    <Caixa
                      icone={IconTrocar}
                      titulo="Empréstimos em aberto"
                      subtitulo="Insumos emprestados e ainda não devolvidos ou pagos"
                      ligacao="/acompanhamentos/insumos/emprestimos"
                      rotuloLigacao="Ver empréstimos"
                      className="flex-1"
                    >
                      <div className="grid grid-cols-2 gap-x-6">
                        <Numero rotulo="Empréstimos" valor={String(insumos.emprestimosAbertos.n)} />
                        <Numero rotulo="Valor em aberto" valor={brl(insumos.emprestimosAbertos.valor)} />
                      </div>
                      <p className="mt-4 border-t border-line pt-3 text-[11.5px] text-muted">
                        {insumos.valor > 0 && insumos.emprestimosAbertos.valor > 0
                          ? `Equivale a ${pct(insumos.emprestimosAbertos.valor, insumos.valor)} do saldo contábil.`
                          : "Dê baixa em Insumos › Empréstimos quando o insumo voltar ou for pago."}
                      </p>
                    </Caixa>
                  )}
                </div>

                <Caixa icone={IconCamadas} titulo="Maiores saldos por grupo" subtitulo="Grupos de maior valor e o maior insumo de cada um">
                  {insumos.grupos.length > 0 ? (
                    <div className="space-y-3.5">
                      {insumos.grupos.map((g) => (
                        <div key={g.grp}>
                          <div className="mb-1 flex items-baseline justify-between gap-3 text-[12.5px]">
                            <span className="truncate text-ink">{frase(g.ds)}</span>
                            <span className="tabular flex-shrink-0 text-ink">
                              {compacto(g.valor)} <span className="text-[11px] text-muted">· {pct(g.valor, insumos.valor)}</span>
                            </span>
                          </div>
                          <Barra valor={g.valor / maxGrupo} cor="#3B5BA9" altura={5} />
                          {g.maior && (
                            <div className="mt-1 truncate text-[11px] text-muted">
                              Maior: {g.maior} · {compacto(g.maiorValor)} · {g.itens} insumo(s)
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Vazio texto="Sem saldo nos depósitos agrícolas." />
                  )}
                </Caixa>

                <Caixa
                  icone={IconGota}
                  titulo="Capacidade de aplicação"
                  subtitulo="Hectares que o saldo cobre: quantidade ÷ dosagem por hectare"
                  ligacao="/acompanhamentos/insumos/dosagens"
                  rotuloLigacao="Ver dosagens"
                  className="lg:col-span-2 xl:col-span-1"
                >
                  {insumos.capacidade.length > 0 ? (
                    <div className="space-y-3.5">
                      {insumos.capacidade.map((c) => (
                        <div key={c.cod}>
                          <div className="mb-1 flex items-baseline justify-between gap-3 text-[12.5px]">
                            <span className="truncate text-ink">{c.ds}</span>
                            <span className="tabular flex-shrink-0 font-medium text-ink">
                              {textoHectares({ de: c.hDe, ate: c.hAte })} <span className="text-[11px] font-normal text-muted">ha</span>
                            </span>
                          </div>
                          <Barra valor={c.hDe / maxHa} cor={VERDE} altura={5} />
                          <div className="mt-1 text-[11px] text-muted">
                            Saldo {nf(c.qtd)} {c.un} · dosagem {textoDosagem({ min: c.min, max: c.max })} {c.un}/ha
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <Vazio texto="Cadastre a dosagem dos insumos em Insumos › Dosagens para calcular os hectares." />
                  )}
                  {insumos.cobertura.comSaldo > 0 && (
                    <p className="mt-4 border-t border-line pt-3 text-[11.5px] text-muted">
                      {insumos.cobertura.comDosagem} de {insumos.cobertura.comSaldo} insumos com saldo têm dosagem cadastrada.
                    </p>
                  )}
                </Caixa>
              </div>
            ) : (
              <Vazio texto="Nenhum saldo de insumos importado ainda. Importe em Insumos › Saldo Insumos." />
            )}
          </Secao>
        </div>
      </CorpoPagina>
    </Pagina>
  );
}
