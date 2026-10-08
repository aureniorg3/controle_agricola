import type { ItemEstoque } from "./estoque-insumos";
import { dataIso, num, txt } from "./import-os";
import { lerLinhas } from "./import-pesagem";

/**
 * Lê o "Relatório de Estoque Físico" do sistema: 1ª linha com a empresa e a "Data Do Relatório", cabeçalho
 * Grupo · Codigo · Descrição · … · UN · Est. Real · Vr Total Real · Disponível · Vr Total Disponível.
 */
export function lerEstoqueFisico(buffer: ArrayBuffer): { emp: number | null; dt: string | null; itens: ItemEstoque[]; erro?: string } {
  const linhas = lerLinhas(buffer);
  let emp: number | null = null;
  let dt: string | null = null;
  let idx = -1;
  const norm = (v: unknown) => txt(v).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  for (let i = 0; i < Math.min(linhas.length, 15); i++) {
    const l = linhas[i];
    if (i === 0 && num(l[0]) !== null) emp = Math.round(num(l[0])!);
    const iData = l.findIndex((c) => /data do relat/.test(norm(c)));
    if (iData >= 0 && !dt) dt = dataIso(l[iData + 1]);
    if (norm(l[0]) === "grupo" && norm(l[1]) === "codigo") {
      idx = i;
      break;
    }
  }
  if (idx < 0) return { emp, dt, itens: [], erro: 'Não encontrei o cabeçalho do "Relatório de Estoque Físico" (Grupo, Codigo, Descrição, UN, Est. Real…).' };
  const cab = linhas[idx].map(norm);
  const col = (re: RegExp, padrao: number) => {
    const i = cab.findIndex((c) => re.test(c));
    return i >= 0 ? i : padrao;
  };
  const c = {
    grp: 0,
    cod: 1,
    ds: col(/^descri/, 2),
    un: col(/^un$/, 4),
    est: col(/^est\.? real/, 5),
    vr: col(/^vr total real/, 6),
    disp: col(/^disponivel$/, 7),
    vrDisp: col(/^vr total disponivel/, 8),
  };
  const itens = new Map<string, ItemEstoque>();
  for (const l of linhas.slice(idx + 1)) {
    const cod = txt(l[c.cod]);
    if (!/^\d+$/.test(cod)) continue;
    const it: ItemEstoque = {
      grp: txt(l[c.grp]),
      cod,
      ds: txt(l[c.ds]),
      un: txt(l[c.un]),
      est: num(l[c.est]) ?? 0,
      vr: num(l[c.vr]) ?? 0,
      disp: num(l[c.disp]) ?? 0,
      vrDisp: num(l[c.vrDisp]) ?? 0,
    };
    const ja = itens.get(cod);
    if (ja) {
      ja.est += it.est;
      ja.vr += it.vr;
      ja.disp += it.disp;
      ja.vrDisp += it.vrDisp;
    } else itens.set(cod, it);
  }
  if (!emp) return { emp, dt, itens: [], erro: "Não encontrei o código da empresa na 1ª linha do relatório." };
  if (!dt) return { emp, dt, itens: [], erro: 'Não encontrei a "Data Do Relatório" no cabeçalho.' };
  return { emp, dt, itens: [...itens.values()] };
}
