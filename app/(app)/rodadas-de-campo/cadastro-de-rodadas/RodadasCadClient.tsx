"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import { Campo } from "@/components/ui";
import { fmtDateBR, todayISO } from "@/lib/format";
import { podeEditar } from "@/lib/permissoes";
import { gerarSemanas, segundaDaSemana, somarDias, type RodadaCad } from "@/lib/rodadas";
import type { PerfilUsuario } from "@/lib/types";

const INPUT =
  "w-full rounded-md border border-line bg-card px-3 py-2 text-[13px] text-ink focus:border-brand-600 focus:outline-none";

export default function RodadasCadClient({ perfil }: { perfil: PerfilUsuario }) {
  const podeGravar = podeEditar(perfil);
  const [rodadas, setRodadas] = useState<RodadaCad[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [rod, setRod] = useState("");
  const [inicio, setInicio] = useState("");
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aberta, setAberta] = useState<number | null>(null);

  const carregar = useCallback(async () => {
    setCarregando(true);
    try {
      const res = await fetch("/api/rodadas/cadastro", { cache: "no-store" });
      const json = await res.json();
      if (res.ok) {
        setRodadas(json.rodadas);
        return json.rodadas as RodadaCad[];
      }
    } finally {
      setCarregando(false);
    }
    return [] as RodadaCad[];
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

  async function salvar(e: FormEvent) {
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

  async function excluir(r: RodadaCad) {
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
    <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
      <header className="flex flex-shrink-0 items-center gap-3 border-b border-line bg-card px-6 py-3">
        <nav className="min-w-0 flex-1 text-[13px] text-muted">
          <span className="text-[11px] uppercase tracking-wide">Rodadas de Campo</span>
          <div className="truncate text-[15px] font-bold text-ink">Cadastro de Rodadas</div>
        </nav>
        {!podeGravar && (
          <div className="rounded-full border border-line bg-surface px-3 py-1.5 text-[12px] font-semibold text-muted">
            Somente leitura
          </div>
        )}
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-5">
        {podeGravar && (
          <form onSubmit={salvar} className="mb-5 rounded-xl2 border border-line bg-card p-4 shadow-card">
            <h2 className="mb-3 text-[14px] font-bold text-ink">Nova rodada</h2>
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
              A rodada tem 8 semanas, cada uma de segunda a domingo. A semana 1 começa na segunda-feira da data de início
              informada. Confira a prévia abaixo antes de gerar.
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
          </form>
        )}

        <div className="overflow-hidden rounded-xl2 border border-line bg-card shadow-card">
          <div className="border-b border-line bg-surface px-4 py-2.5">
            <h2 className="text-[14px] font-bold text-ink">Rodadas cadastradas</h2>
          </div>
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
        </div>
      </div>
    </div>
  );
}

function FragmentoRodada({
  r,
  aberta,
  onAlternar,
  onExcluir,
}: {
  r: RodadaCad;
  aberta: boolean;
  onAlternar: () => void;
  onExcluir?: () => void;
}) {
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
          <button
            type="button"
            onClick={onAlternar}
            className="mr-1 rounded px-1.5 py-0.5 text-[12px] font-semibold text-brand-700 hover:bg-brand-50"
          >
            {aberta ? "Ocultar" : "Calendário"}
          </button>
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
