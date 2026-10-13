/** Utilitários de leitura de planilha (célula vazia, texto, número, data e código de O.S.) usados pelas importações. */

export const vazio = (v) => v === null || v === undefined || (typeof v === "string" && (v.trim() === "" || v.trim() === "\\N"));
export const txt = (v) => (vazio(v) ? "" : typeof v === "number" ? String(Number.isInteger(v) ? v : v) : String(v).replace(/\s+/g, " ").trim());
export const num = (v) => {
  if (vazio(v)) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  const s = String(v).trim();
  const n = s.includes(",") ? Number(s.replace(/\./g, "").replace(",", ".")) : Number(s);
  return Number.isFinite(n) ? n : null;
};
/** número de série do Excel (dias desde 1899-12-30) ou "dd/mm/aaaa" → ISO */
export function dataIso(v) {
  if (vazio(v)) return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) return v.toISOString().slice(0, 10);
  if (typeof v === "number" && v > 20000 && v < 80000) return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  const m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (m) return `${m[3]}-${m[2]}-${m[1]}`;
  const iso = String(v).match(/^(\d{4}-\d{2}-\d{2})/);
  return iso ? iso[1] : null;
}
/** a O.S. às vezes vem formatada como data no Excel (1 = 01/01/1900): volta a ser o número */
export function codigoOS(v) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) return String(Math.round((v.getTime() - Date.UTC(1899, 11, 30)) / 86400000));
  const n = num(v);
  return n !== null && Number.isInteger(n) ? String(n) : txt(v);
}
