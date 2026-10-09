"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CabecalhoPagina, CorpoPagina, Pagina, Painel, Selo } from "@/components/pagina";
import { Campo, ModalShell } from "@/components/ui";
import { fmtDateBR, todayISO } from "@/lib/format";
import { podeEditar, podeIncluirCadastro } from "@/lib/permissoes";
import { gerarSemanas, segundaDaSemana, somarDias } from "@/lib/rodadas";

const INPUT = "w-full rounded-md border border-line bg-card px-3 py-2 text-[13px] text-ink focus:border-brand-600 focus:outline-none";

export default function RodadasCadClient({ perfil }) {
  const podeGravar = podeEditar(perfil);
  const podeIncluir = podeIncluirCadastro(perfil);
  const [rodadas, setRodadas] = useState([]);
  const [carregando, setCarregando] = useState(true);
  const [rod, setRod] = useState("");
  const [inicio, setInicio] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);
  const [aberta, setAberta] = useState(null);
  const [editando, setEditando] = useState(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const res = await fetch("/api/rodadas/cadastro", { cache: "no-store" });
      const json = await res.json();
      if (res.ok) {
        setRodadas(json.rodadas);
        return json.rodadas;
      }
    } finally {
      setCarregando(false);
    }
    return [];
  }, []);

  // sugere o próximo número e a segunda-feira seguinte à última rodada
  useEffect(() => {
    carregar().then((lista) => {
      const maior = lista.reduce((m, r) => Math.max(m, r.rod), 0);
      setRod(String(maior + 1));
      const ultima = lista.find((r) => r.rod === maior);
      const fim = ultima?.semanas[ultima.semanas.length - 1]?.fim;
      setInicio(fim ? somarDias(fim, 1) : segundaDaSemana(todayISO()));
    });
  }, [carregar]);

  const previa = useMemo(() => (inicio ? gerarSemanas(inicio) : []), [inicio]);

  async function salvar(e) {
    e.preventDefault();
    setErro(null);
    if (!/^\d+$/.test(rod.trim()) || Number(rod) <= 0) return setErro("Informe o número da rodada.");
    if (!inicio) return setErro("Informe a data de início.");
    setSalvando(true);
    try {
      const res = await fetch("/api/rodadas/cadastro", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rod: Number(rod), inicio }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error ?? "Não foi possível salvar a rodada.");
      const lista = await carregar();
      const maior = lista.reduce((m, r) => Math.max(m, r.rod), 0);
      setAberta(Number(rod));
      setRod(String(maior + 1));
      const nova = lista.find((r) => r.rod === maior);
      const fim = nova?.semanas[nova.semanas.length - 1]?.fim;
      if (fim) setInicio(somarDias(fim, 1));
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Não foi possível salvar a rodada.");
    } finally {
      setSalvando(false);
    }
  }

  async function excluir(r) {
    if (!window.confirm(`Excluir a rodada ${r.rod} e o seu calendário?`)) return;
    const res = await fetch("/api/rodadas/cadastro", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ rod: r.rod }),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) window.alert(json.error ?? "Não foi possível excluir.");
    else carregar();
  }

  return (
    <Pagina>
      <CabecalhoPagina titulo="Cadastro de Rodadas" categoria="Rodadas de Campo" info={!podeGravar && <Selo>Somente leitura</Selo>} />

      <CorpoPagina>
        {podeIncluir && (
          <form onSubmit={salvar} className="mb-5">
            <Painel titulo="Nova rodada">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
                <Campo label="Nº da rodada">
                  <input value={rod} onChange={(e) => setRod(e.target.value)} inputMode="numeric" className={INPUT} />
                </Campo>
                <Campo label="Data de início (semana 1)">
                  <input type="date" value={inicio} onChange={(e) => setInicio(e.target.value)} className={INPUT} />
                </Campo>
                <button
                  type="submit"
                  disabled={salvando}
                  className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white shadow-card hover:bg-navy-800 disabled:opacity-50"
                >
                  {salvando ? "Gerando…" : "Gerar calendário"}
                </button>
              </div>
              {erro && <p className="mt-2 text-[12.5px] font-medium text-alert-600">{erro}</p>}
              <p className="mt-3 text-[12px] leading-relaxed text-muted">
                A rodada tem 8 semanas, cada uma de segunda a domingo. A semana 1 começa na segunda-feira da data de início informada. Confira a prévia abaixo
                antes de gerar.
              </p>
              {previa.length > 0 && (
                <table className="mt-3 w-full max-w-md text-[12.5px]">
                  <thead>
                    <tr className="border-b border-line bg-surface text-left text-muted">
                      <th className="px-3 py-1.5 text-right font-semibold">Semana</th>
                      <th className="px-3 py-1.5 font-semibold">Início (seg)</th>
                      <th className="px-3 py-1.5 font-semibold">Fim (dom)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {previa.map((s) => (
                      <tr key={s.sem} className="border-b border-line/60">
                        <td className="px-3 py-1 text-right tabular text-ink">{s.sem}</td>
                        <td className="px-3 py-1 text-ink">{fmtDateBR(s.ini)}</td>
                        <td className="px-3 py-1 text-ink">{fmtDateBR(s.fim)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Painel>
          </form>
        )}

        <Painel titulo="Rodadas cadastradas" semEspaco>
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="border-b border-line bg-surface text-left text-muted">
                <th className="px-4 py-2 text-right font-semibold">Rodada</th>
                <th className="px-3 py-2 font-semibold">Início</th>
                <th className="px-3 py-2 font-semibold">Fim</th>
                <th className="px-3 py-2 text-right font-semibold">Semanas</th>
                <th className="px-3 py-2 text-right font-semibold">Nº Boletins</th>
                <th className="w-40 px-2 py-2 text-right font-semibold">Ações</th>
              </tr>
            </thead>
            <tbody>
              {rodadas.map((r) => (
                <FragmentoRodada
                  key={r.rod}
                  r={r}
                  aberta={aberta === r.rod}
                  onAlternar={() => setAberta(aberta === r.rod ? null : r.rod)}
                  onExcluir={podeGravar ? () => excluir(r) : undefined}
                  onEditar={podeGravar ? () => setEditando(r) : undefined}
                />
              ))}
              {!carregando && rodadas.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-4 py-10 text-center text-muted">
                    Nenhuma rodada cadastrada ainda.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </Painel>
      </CorpoPagina>
      {editando && (
        <EditarSemanasModal
          rodada={editando}
          onFechar={() => setEditando(null)}
          onSalvo={() => {
            setEditando(null);
            carregar();
          }}
        />
      )}
    </Pagina>
  );
}

function EditarSemanasModal({ rodada, onFechar, onSalvo }) {
  const [semanas, setSemanas] = useState(() => rodada.semanas.map((s) => ({ ...s })));
  const [base, setBase] = useState(rodada.semanas[0]?.ini ?? "");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState(null);

  function alterar(sem, campo, valor) {
    setSemanas((l) => l.map((s) => (s.sem === sem ? { ...s, [campo]: valor } : s)));
  }

  // refaz as semanas de segunda a domingo a partir da data escolhida (mantém o mesmo número de semanas)
  function recalcular() {
    if (!base) return;
    const novas = gerarSemanas(base);
    setSemanas((l) => l.map((s, i) => (novas[i] ? { ...s, ini: novas[i].ini, fim: novas[i].fim } : s)));
  }

  async function salvar() {
    setErro(null);
    setSalvando(true);
    try {
      const res = await fetch("/api/rodadas/cadastro", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rod: rodada.rod, semanas }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error ?? "Não foi possível salvar as semanas.");
      onSalvo();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível salvar as semanas.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <ModalShell titulo={`Configurar semanas · Rodada ${rodada.rod}`} onFechar={onFechar}>
      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-surface p-2.5">
        <Campo label="Refazer de segunda a domingo a partir de">
          <input type="date" value={base} onChange={(e) => setBase(e.target.value)} className={INPUT} />
        </Campo>
        <button
          type="button"
          onClick={recalcular}
          className="rounded-lg border border-line bg-card px-3 py-2 text-[12.5px] font-semibold text-navy-800 hover:bg-surface"
        >
          Recalcular
        </button>
      </div>
      <table className="w-full text-[12.5px]">
        <thead>
          <tr className="border-b border-line text-left text-muted">
            <th className="px-2 py-1.5 text-right font-semibold">Semana</th>
            <th className="px-2 py-1.5 font-semibold">Início</th>
            <th className="px-2 py-1.5 font-semibold">Fim</th>
          </tr>
        </thead>
        <tbody>
          {semanas.map((s) => (
            <tr key={s.sem} className="border-b border-line/60">
              <td className="px-2 py-1 text-right font-semibold tabular text-ink">{s.sem}</td>
              <td className="px-2 py-1">
                <input type="date" value={s.ini} onChange={(e) => alterar(s.sem, "ini", e.target.value)} className={INPUT} />
              </td>
              <td className="px-2 py-1">
                <input type="date" value={s.fim} onChange={(e) => alterar(s.sem, "fim", e.target.value)} className={INPUT} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rodada.boletins > 0 && (
        <p className="mt-2 text-[11.5px] text-muted">
          Esta rodada tem {rodada.boletins} boletim(ns). Eles guardam só o número da semana, então mudar as datas não os altera.
        </p>
      )}
      {erro && <p className="mt-2 text-[12.5px] font-medium text-alert-600">{erro}</p>}
      <div className="mt-4 flex justify-end gap-2">
        <button type="button" onClick={onFechar} className="rounded-lg border border-line px-4 py-2 text-[13px] font-semibold text-ink">
          Cancelar
        </button>
        <button
          type="button"
          onClick={salvar}
          disabled={salvando}
          className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white disabled:opacity-50"
        >
          {salvando ? "Salvando…" : "Salvar semanas"}
        </button>
      </div>
    </ModalShell>
  );
}

function FragmentoRodada({ r, aberta, onAlternar, onExcluir, onEditar }) {
  const fim = r.semanas[r.semanas.length - 1]?.fim;
  return (
    <>
      <tr className="border-b border-line/60">
        <td className="px-4 py-1.5 text-right font-semibold tabular text-ink">{r.rod}</td>
        <td className="px-3 py-1.5 text-ink">{fmtDateBR(r.ini)}</td>
        <td className="px-3 py-1.5 text-ink">{fim ? fmtDateBR(fim) : ""}</td>
        <td className="px-3 py-1.5 text-right tabular text-ink">{r.semanas.length}</td>
        <td className="px-3 py-1.5 text-right tabular text-ink">{r.boletins}</td>
        <td className="px-2 py-1.5 text-right">
          <button type="button" onClick={onAlternar} className="mr-1 rounded px-1.5 py-0.5 text-[12px] font-semibold text-brand-700 hover:bg-brand-50">
            {aberta ? "Ocultar" : "Calendário"}
          </button>
          {onEditar && (
            <button type="button" onClick={onEditar} className="mr-1 rounded px-1.5 py-0.5 text-[12px] font-semibold text-brand-700 hover:bg-brand-50">
              Editar
            </button>
          )}
          {onExcluir && (
            <button
              type="button"
              onClick={onExcluir}
              aria-label="Excluir rodada"
              className="rounded px-1.5 text-[15px] leading-none text-muted hover:bg-alert-50 hover:text-alert-600"
            >
              ×
            </button>
          )}
        </td>
      </tr>
      {aberta && (
        <tr className="border-b border-line/60 bg-surface">
          <td colSpan={6} className="px-4 py-2">
            <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-[12px] sm:grid-cols-4">
              {r.semanas.map((s) => (
                <div key={s.sem} className="text-ink">
                  <b>Semana {s.sem}</b> · {fmtDateBR(s.ini).slice(0, 5)} a {fmtDateBR(s.fim).slice(0, 5)}
                </div>
              ))}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
