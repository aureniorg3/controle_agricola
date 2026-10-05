"use client";

import { useEffect, useState } from "react";
import { fmtDateBR } from "@/lib/format";
import type { RegistroAuditoria } from "@/lib/auditoria";

/** "2026-10-05T08:41:20" -> "05/10/2026 08:41:20" */
export function fmtDataHora(iso: string): string {
  const [d, h] = iso.split("T");
  return `${fmtDateBR(d)} ${h ?? ""}`.trim();
}

/** Log de alterações (data, hora, usuário, ação e conteúdo) — de um registro ou do módulo todo. */
export default function AuditoriaModal({
  titulo,
  filtro,
  onFechar,
}: {
  titulo: string;
  filtro: { modulo?: string; entidade?: string; chave?: string; q?: string };
  onFechar: () => void;
}) {
  const [linhas, setLinhas] = useState<RegistroAuditoria[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(filtro)) if (v) p.set(k, v);
    fetch(`/api/auditoria?${p}`, { cache: "no-store" })
      .then((r) => r.json().then((j) => ({ ok: r.ok, j })))
      .then(({ ok, j }) => (ok ? setLinhas(j.registros) : setErro(j.error ?? "Não foi possível carregar o log.")))
      .catch(() => setErro("Não foi possível carregar o log."));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filtro)]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/50 px-3">
      <div className="flex max-h-[88vh] w-full max-w-5xl flex-col rounded-xl2 bg-card p-4 shadow-pop md:p-5">
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[15px] font-bold text-ink">{titulo}</h3>
          <button type="button" onClick={onFechar} aria-label="Fechar" className="px-1 text-[20px] leading-none text-muted">
            ×
          </button>
        </div>
        <div className="min-h-[120px] flex-1 overflow-auto rounded-md border border-line">
          {erro ? (
            <p className="px-3 py-4 text-[12.5px] text-alert-600">{erro}</p>
          ) : linhas === null ? (
            <p className="px-3 py-4 text-[12.5px] text-muted">Carregando…</p>
          ) : linhas.length === 0 ? (
            <p className="px-3 py-4 text-[12.5px] text-muted">Nenhum registro no log.</p>
          ) : (
            <TabelaAuditoria linhas={linhas} />
          )}
        </div>
        <div className="mt-3 flex justify-end">
          <button type="button" onClick={onFechar} className="rounded-lg bg-navy-900 px-4 py-2 text-[13px] font-semibold text-white">
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
}

export function TabelaAuditoria({ linhas }: { linhas: RegistroAuditoria[] }) {
  return (
    <table className="w-full text-[12px]">
      <thead>
        <tr className="border-b border-line bg-navy-900 text-left text-white">
          <th className="whitespace-nowrap px-3 py-2 font-semibold">Data e hora</th>
          <th className="px-3 py-2 font-semibold">Usuário</th>
          <th className="px-3 py-2 font-semibold">Módulo</th>
          <th className="px-3 py-2 font-semibold">O que</th>
          <th className="px-3 py-2 font-semibold">Ação</th>
          <th className="px-3 py-2 font-semibold">Detalhes</th>
        </tr>
      </thead>
      <tbody>
        {linhas.map((l, i) => (
          <tr key={l.id} className={`border-b border-line/60 align-top ${i % 2 === 1 ? "bg-surface" : "bg-card"}`}>
            <td className="whitespace-nowrap px-3 py-1.5 text-ink">{fmtDataHora(l.em)}</td>
            <td className="whitespace-nowrap px-3 py-1.5 text-ink">{l.usuario || "—"}</td>
            <td className="whitespace-nowrap px-3 py-1.5 text-ink">{l.modulo}</td>
            <td className="min-w-[160px] px-3 py-1.5 text-ink">
              <span className="font-semibold">{l.entidade}</span>
              {l.chave && <span className="block text-muted">{l.chave}</span>}
            </td>
            <td className="whitespace-nowrap px-3 py-1.5 font-semibold text-ink">{l.acao}</td>
            <td className="min-w-[240px] px-3 py-1.5 text-muted">{l.resumo}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
