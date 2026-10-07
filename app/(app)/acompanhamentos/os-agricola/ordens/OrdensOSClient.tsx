"use client";

import { Fragment, useEffect, useState } from "react";
import { fmtDateBR } from "@/lib/format";
import type { LinhaOSAgr, OrdemServicoAgr } from "@/lib/os-agr";
import { nomePosicao } from "@/lib/os-agr";
import { podeEditar } from "@/lib/permissoes";
import type { PerfilUsuario } from "@/lib/types";
import { ehBooleano, ehTexto, usarPersistido } from "@/lib/usar-persistido";
import { nf } from "@/app/(app)/painel/blocos";
import { BarraFiltrosOS, BotaoExportar, BotaoImportarOS, FILTRO, SeloPosicao, paramsDosFiltros, usarFiltrosOS, usarOpcoesOS } from "../comum";

interface Totais {
  ordens: number;
  abertas: number;
  atrasadas: number;
  areaRec: number;
  talhoes: number;
}

const int = (n: number) => n.toLocaleString("pt-BR");
const data = (iso: string | null) => (iso ? fmtDateBR(iso) : "");

export default function OrdensOSClient({ perfil }: { perfil: PerfilUsuario }) {
  const [f, setF] = usarFiltrosOS();
  const [op, setOp] = usarPersistido("os-agr.ordens.op", "", ehTexto);
  const [faixa, setFaixa] = usarPersistido("os-agr.ordens.faixa", "", ehTexto);
  const [atrasadas, setAtrasadas] = usarPersistido("os-agr.ordens.atrasadas", false, ehBooleano);
  const [busca, setBusca] = usarPersistido("os-agr.ordens.busca", "", ehTexto);
  const [termo, setTermo] = useState(busca);
  const [pagina, setPagina] = useState(1);
  const [versao, setVersao] = useState(0);
  const opcoes = usarOpcoesOS(versao);
  const [ordens, setOrdens] = useState<OrdemServicoAgr[]>([]);
  const [totais, setTotais] = useState<Totais | null>(null);
  const [tamanho, setTamanho] = useState(100);
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<string | null>(null);

  // vindo do Dashboard (clique numa faixa de dias): só as em aberto daquela faixa
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const fx = p.get("faixa");
    if (fx) {
      setFaixa(fx);
      setF((x) => ({ ...x, posicao: "aberto" }));
      window.history.replaceState(null, "", window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const t = setTimeout(() => setTermo(busca), 350);
    return () => clearTimeout(t);
  }, [busca]);

  const params = () => {
    const p = paramsDosFiltros(f);
    if (op) p.set("op", op);
    if (faixa) p.set("faixa", faixa);
    if (atrasadas) p.set("atrasadas", "1");
    if (termo.trim()) p.set("q", termo.trim());
    return p;
  };
  const chaveFiltro = JSON.stringify([f, op, faixa, atrasadas, termo]);
  useEffect(() => setPagina(1), [chaveFiltro]);

  useEffect(() => {
    let ativo = true;
    setCarregando(true);
    const p = params();
    p.set("pg", String(pagina));
    fetch(`/api/os-agricola?${p}`, { cache: "no-store" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (!ativo) return;
        if (!ok) return setErro(j.error ?? "Não foi possível carregar as O.S.");
        setErro(null);
        setOrdens(j.ordens);
        setTotais(j.totais);
        setTamanho(j.tamanho);
      })
      .catch(() => ativo && setErro("Não foi possível carregar as O.S."))
      .finally(() => ativo && setCarregando(false));
    return () => {
      ativo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chaveFiltro, pagina, versao]);

  async function todas(): Promise<OrdemServicoAgr[]> {
    const p = params();
    p.set("todos", "1");
    const res = await fetch(`/api/os-agricola?${p}`, { cache: "no-store" });
    const j = await res.json();
    if (!res.ok) throw new Error(j.error ?? "Não foi possível exportar.");
    return j.ordens;
  }

  const totalPaginas = Math.max(1, Math.ceil((totais?.ordens ?? 0) / tamanho));

  return (
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-shrink-0 flex-wrap items-center gap-3 border-b border-line bg-card px-6 py-3">
        <nav className="min-w-0 flex-1 text-[13px] text-muted">
          <span className="text-[11px] uppercase tracking-wide">Ordem de Serviço Agr.</span>
          <div className="truncate text-[15px] font-bold text-ink">Ordens de Serviço</div>
        </nav>
        {opcoes?.ultimaImportacao && <span className="text-[12px] text-muted">Base atualizada em {opcoes.ultimaImportacao}</span>}
        <BotaoExportar<OrdemServicoAgr>
          nome="Ordens de Servico"
          buscar={todas}
          colunas={[
            { rotulo: "O.S.", valor: (o) => Number(o.os) || o.os },
            { rotulo: "Data da O.S.", valor: (o) => data(o.dtOs) },
            { rotulo: "Previsão final", valor: (o) => data(o.prevFim) },
            { rotulo: "Encerramento", valor: (o) => data(o.dtEnc) },
            { rotulo: "Posição", valor: (o) => nomePosicao(o.posicao) },
            { rotulo: "Dias", valor: (o) => o.dias },
            { rotulo: "Faixa de dias", valor: (o) => o.faixa },
            { rotulo: "Previsão vencida", valor: (o) => (o.atrasada ? "Sim" : "") },
            { rotulo: "Operação", valor: (o) => o.operacoes.map((x) => `${x.cod} - ${x.ds}`).join(" | ") },
            { rotulo: "Etapa", valor: (o) => `${o.etapaCod} - ${o.etapaDs}` },
            { rotulo: "Solicitante", valor: (o) => o.respNm },
            { rotulo: "Fazenda", valor: (o) => o.fazendas.map((x) => x.split(" · ")[0]).join(" | ") },
            { rotulo: "Descrição Fazenda", valor: (o) => o.fazendas.map((x) => x.split(" · ").slice(1).join(" · ")).join(" | ") },
            { rotulo: "Talhões", valor: (o) => o.nTlh },
            { rotulo: "Área plantada (ha)", valor: (o) => o.areaPlant },
            { rotulo: "Área recomendada (ha)", valor: (o) => o.areaRec },
            { rotulo: "Safra", valor: (o) => o.safra },
            { rotulo: "Lançada por", valor: (o) => o.usrOs },
          ]}
        />
        {podeEditar(perfil) && <BotaoImportarOS onImportado={() => setVersao((v) => v + 1)} />}
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mb-4 rounded-xl2 border border-line bg-card px-4 py-3 shadow-card">
          <BarraFiltrosOS
            f={f}
            setF={setF}
            opcoes={opcoes}
            extra={
              <>
                <label className="flex flex-col gap-1 text-[11.5px] text-muted">
                  Operação
                  <select value={op} onChange={(e) => setOp(e.target.value)} className={`${FILTRO} max-w-[240px]`}>
                    <option value="">Todas</option>
                    {opcoes?.operacoes.map((o) => (
                      <option key={o.cod} value={o.cod}>
                        {o.cod} · {o.nome}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[11.5px] text-muted">
                  Faixa de dias (em aberto)
                  <select value={faixa} onChange={(e) => setFaixa(e.target.value)} className={FILTRO}>
                    <option value="">Todas</option>
                    {opcoes?.faixas.map((x) => (
                      <option key={x.descricao} value={x.descricao}>
                        {x.descricao}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex flex-col gap-1 text-[11.5px] text-muted">
                  Buscar
                  <input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="O.S., fazenda, operação…" className={`${FILTRO} w-[200px]`} />
                </label>
                <label className="flex items-center gap-1.5 pb-1.5 text-[12.5px] text-ink">
                  <input type="checkbox" checked={atrasadas} onChange={(e) => setAtrasadas(e.target.checked)} />
                  Só previsão vencida
                </label>
              </>
            }
          />
        </div>

        {totais && (
          <div className="mb-3 flex flex-wrap gap-x-6 gap-y-1 text-[12.5px] text-muted">
            <span>
              <b className="tabular font-semibold text-ink">{int(totais.ordens)}</b> O.S.
            </span>
            <span>
              <b className="tabular font-semibold text-ink">{int(totais.abertas)}</b> em aberto
            </span>
            <span>
              <b className="tabular font-semibold text-[#BE3132]">{int(totais.atrasadas)}</b> com previsão vencida
            </span>
            <span>
              <b className="tabular font-semibold text-ink">{int(totais.talhoes)}</b> talhões
            </span>
            <span>
              <b className="tabular font-semibold text-ink">{nf(totais.areaRec)}</b> ha recomendados
            </span>
          </div>
        )}

        {erro && <p className="mb-3 rounded-md border border-alert-500/40 bg-alert-50 px-3 py-2 text-[12.5px] text-alert-700">{erro}</p>}

        <div className={`overflow-hidden rounded-xl2 border border-line bg-card shadow-card transition-opacity ${carregando ? "opacity-60" : ""}`}>
          <div className="overflow-x-auto">
            <table className="w-full text-[12.5px]">
              <thead>
                <tr className="border-b border-line bg-surface text-left text-muted">
                  <th className="w-6 px-2 py-2" />
                  <th className="px-3 py-2 text-right font-medium">O.S.</th>
                  <th className="px-3 py-2 font-medium">Data</th>
                  <th className="px-3 py-2 font-medium">Posição</th>
                  <th className="px-3 py-2 text-right font-medium">Dias</th>
                  <th className="px-3 py-2 font-medium">Previsão final</th>
                  <th className="px-3 py-2 font-medium">Encerramento</th>
                  <th className="min-w-[220px] px-3 py-2 font-medium">Operação</th>
                  <th className="px-3 py-2 font-medium">Etapa</th>
                  <th className="px-3 py-2 font-medium">Solicitante</th>
                  <th className="px-3 py-2 font-medium">Fazenda</th>
                  <th className="min-w-[180px] px-3 py-2 font-medium">Descrição Fazenda</th>
                  <th className="px-3 py-2 text-right font-medium">Talhões</th>
                  <th className="px-3 py-2 text-right font-medium">Área rec. (ha)</th>
                  <th className="px-3 py-2 font-medium">Lançada por</th>
                </tr>
              </thead>
              <tbody>
                {ordens.map((o) => {
                  const k = `${o.emp}|${o.os}`;
                  const ab = aberta === k;
                  return (
                    <Fragment key={k}>
                      <tr className={`cursor-pointer border-t border-line/60 hover:bg-surface/60 ${ab ? "bg-[#2E5FA8]/[0.06]" : ""}`} onClick={() => setAberta(ab ? null : k)}>
                        <td className="px-2 py-1.5 text-center text-muted">{ab ? "▾" : "▸"}</td>
                        <td className="px-3 py-1.5 text-right tabular font-medium text-ink">{o.os}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-ink">{data(o.dtOs)}</td>
                        <td className="px-3 py-1.5">
                          <SeloPosicao p={o.posicao} />
                        </td>
                        <td className="px-3 py-1.5 text-right tabular text-ink" title={o.faixa || undefined}>
                          {o.dias ?? "–"}
                        </td>
                        <td className={`whitespace-nowrap px-3 py-1.5 ${o.atrasada ? "font-medium text-[#BE3132]" : "text-ink"}`}>{data(o.prevFim)}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-ink">{data(o.dtEnc) || "–"}</td>
                        <td className="px-3 py-1.5 text-ink">
                          {o.operacoes[0] && (
                            <>
                              <span className="tabular text-muted">{o.operacoes[0].cod} · </span>
                              {o.operacoes[0].ds}
                            </>
                          )}
                          {o.operacoes.length > 1 && <span className="ml-1 text-[11px] text-muted">+{o.operacoes.length - 1}</span>}
                        </td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-ink">{o.etapaDs}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-ink">{o.respNm || "–"}</td>
                        <td className="px-3 py-1.5 tabular text-ink">
                          {o.fazendas[0]?.split(" · ")[0]}
                          {o.fazendas.length > 1 && <span className="ml-1 text-[11px] text-muted">+{o.fazendas.length - 1}</span>}
                        </td>
                        <td className="px-3 py-1.5 text-ink">{o.fazendas[0]?.split(" · ").slice(1).join(" · ")}</td>
                        <td className="px-3 py-1.5 text-right tabular text-ink">{o.nTlh}</td>
                        <td className="px-3 py-1.5 text-right tabular text-ink">{nf(o.areaRec)}</td>
                        <td className="whitespace-nowrap px-3 py-1.5 text-muted">{o.usrOs}</td>
                      </tr>
                      {ab && (
                        <tr className="border-t border-line/60 bg-surface/50">
                          <td />
                          <td colSpan={14} className="px-3 py-3">
                            <TalhoesOS emp={o.emp} os={o.os} />
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  );
                })}
                {!carregando && ordens.length === 0 && (
                  <tr>
                    <td colSpan={15} className="px-4 py-10 text-center text-muted">
                      {opcoes?.ordens === 0 ? 'A base de O.S. está vazia. Use "Importar O.S." com o Relatório de Ordens de Serviço.' : "Nenhuma O.S. no filtro."}
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="flex items-center justify-between border-t border-line bg-surface px-4 py-2 text-[12.5px] text-muted">
            <span>{carregando ? "Carregando…" : `Página ${pagina} de ${totalPaginas}`}</span>
            <span className="flex gap-1.5">
              <button type="button" disabled={pagina <= 1 || carregando} onClick={() => setPagina((p) => p - 1)} className="rounded-md border border-line bg-card px-2.5 py-1 font-medium text-navy-800 disabled:opacity-40">
                Anterior
              </button>
              <button
                type="button"
                disabled={pagina >= totalPaginas || carregando}
                onClick={() => setPagina((p) => p + 1)}
                className="rounded-md border border-line bg-card px-2.5 py-1 font-medium text-navy-800 disabled:opacity-40"
              >
                Próxima
              </button>
            </span>
          </div>
        </div>
        <p className="mt-3 text-[11.5px] text-muted">
          Dias: O.S. em aberto, desde a data da O.S. até hoje; encerrada, da data da O.S. ao encerramento. Previsão em vermelho = vencida com a O.S. ainda em
          aberto. Clique numa O.S. para ver os talhões.
        </p>
      </div>
    </div>
  );
}

function TalhoesOS({ emp, os }: { emp: string; os: string }) {
  const [linhas, setLinhas] = useState<LinhaOSAgr[] | null>(null);
  useEffect(() => {
    fetch(`/api/os-agricola?talhoes=1&emp=${encodeURIComponent(emp)}&os=${encodeURIComponent(os)}`, { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => setLinhas(j.talhoes ?? []))
      .catch(() => setLinhas([]));
  }, [emp, os]);
  if (!linhas) return <span className="text-[12px] text-muted">Carregando talhões…</span>;
  const p = linhas[0];
  return (
    <div className="space-y-2">
      {p && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 text-[12px] text-muted">
          <span>Centro de custo: {p.ccCod ? `${p.ccCod} · ${p.ccDs}` : "–"}</span>
          <span>Previsão: {data(p.prevIni)} a {data(p.prevFim)}</span>
          <span>Execução: {p.mesExec && p.anoExec ? `${String(p.mesExec).padStart(2, "0")}/${p.anoExec}` : "–"}</span>
          {p.obs && <span>Obs.: {p.obs}</span>}
        </div>
      )}
      <table className="w-full max-w-4xl rounded-lg border border-line bg-card text-[12px]">
        <thead>
          <tr className="border-b border-line text-left text-muted">
            <th className="px-3 py-1.5 font-medium">Operação</th>
            <th className="px-3 py-1.5 font-medium">Fazenda</th>
            <th className="px-3 py-1.5 font-medium">Descrição Fazenda</th>
            <th className="px-3 py-1.5 text-center font-medium">Talhão</th>
            <th className="px-3 py-1.5 text-right font-medium">Área plantada (ha)</th>
            <th className="px-3 py-1.5 text-right font-medium">Área recomendada (ha)</th>
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => (
            <tr key={`${l.opCod}|${l.propCod}|${l.setor}|${l.tlh}|${l.letra}`} className="border-t border-line/60">
              <td className="px-3 py-1 text-ink">
                <span className="tabular text-muted">{l.opCod} · </span>
                {l.opDs}
              </td>
              <td className="px-3 py-1 tabular text-ink">{l.propCod}</td>
              <td className="px-3 py-1 text-ink">{l.propNm}</td>
              <td className="px-3 py-1 text-center text-ink">
                {l.tlh}
                {l.letra}
              </td>
              <td className="px-3 py-1 text-right tabular text-ink">{l.areaPlant === null ? "–" : nf(l.areaPlant)}</td>
              <td className="px-3 py-1 text-right tabular text-ink">{l.areaRec === null ? "–" : nf(l.areaRec)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
