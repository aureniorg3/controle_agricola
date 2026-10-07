/** Exporta uma lista para CSV (Excel em português: ";" e vírgula decimal) ou XLSX, no navegador. */

export interface ColunaExportacao<T> {
  rotulo: string;
  valor: (l: T) => string | number | null | undefined;
}

export type FormatoExportacao = "csv" | "xlsx";

const carimbo = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
};

export async function exportarPlanilha<T>(nome: string, colunas: ColunaExportacao<T>[], linhas: T[], formato: FormatoExportacao): Promise<void> {
  const arquivo = `${nome}_${carimbo()}`;
  if (formato === "xlsx") {
    const XLSX = await import("xlsx");
    const dados = [colunas.map((c) => c.rotulo), ...linhas.map((l) => colunas.map((c) => c.valor(l) ?? ""))];
    const ws = XLSX.utils.aoa_to_sheet(dados);
    ws["!cols"] = colunas.map((c, i) => ({ wch: Math.min(50, Math.max(c.rotulo.length, ...dados.slice(1, 200).map((r) => String(r[i] ?? "").length)) + 2) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, nome.slice(0, 31));
    XLSX.writeFile(wb, `${arquivo}.xlsx`);
    return;
  }
  const celula = (v: string | number | null | undefined) => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "number" ? String(v).replace(".", ",") : v;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const texto = [colunas.map((c) => celula(c.rotulo)).join(";"), ...linhas.map((l) => colunas.map((c) => celula(c.valor(l))).join(";"))].join("\r\n");
  // BOM para o Excel abrir com acentos
  const blob = new Blob(["﻿" + texto], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${arquivo}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
