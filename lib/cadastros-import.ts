import * as XLSX from "xlsx";
import { dataIso, paraCadaLinha } from "./import-pesagem";
import {
  normalizarTexto,
  type CadastroSpec,
  type DadosCadastro,
  type ValorCadastro,
} from "./cadastros-spec";

function chavesDoCabecalho(linha: unknown[]): string[] {
  const usadas = new Map<string, number>();
  return linha.map((c, i) => {
    const base = normalizarTexto(String(c ?? "")).replace(/ /g, "_") || `col_${i + 1}`;
    const n = (usadas.get(base) ?? 0) + 1;
    usadas.set(base, n);
    return n === 1 ? base : `${base}_${n}`;
  });
}

function valorDaCelula(c: unknown): ValorCadastro {
  if (c instanceof Date) return dataIso(c) ?? "";
  if (typeof c === "number") return Number.isFinite(c) ? c : "";
  return String(c ?? "")
    .replace(/\s+/g, " ")
    .trim();
}

export interface ResultadoCadastro {
  itens: { cod: string; nm: string; dados: DadosCadastro }[];
  linhasLidas: number;
  repetidas: number;
  avisos: string[];
  erros: string[];
}

/**
 * Versão em fluxo para planilhas enormes (ex.: Material e Insumos, ~120 mil linhas): não materializa a planilha
 * inteira e só guarda as colunas listadas no cadastro, para caber na memória da instância e no banco.
 */
export async function lerCadastroGrande(buffer: ArrayBuffer, spec: CadastroSpec, ajustar = false): Promise<ResultadoCadastro> {
  const res: ResultadoCadastro = { itens: [], linhasLidas: 0, repetidas: 0, avisos: [], erros: [] };
  const guardar = new Set(spec.colunas.map((c) => c.chave));
  let chaves: string[] | null = null;
  let n = 0;
  const porCodigo = new Map<string, { cod: string; nm: string; dados: DadosCadastro }>();
  const lerLinha = (linha: unknown[]) => {
    n++;
    if (!chaves) {
      if (n > 25) return;
      const candidatas = chavesDoCabecalho(linha);
      if (spec.obrigatorias.every((k) => candidatas.includes(k))) chaves = candidatas;
      return;
    }
    const dados: DadosCadastro = {};
    let preenchida = false;
    chaves.forEach((k, j) => {
      const v = valorDaCelula(linha[j]);
      if (v !== "") preenchida = true;
      if (guardar.has(k) || spec.obrigatorias.includes(k)) dados[k] = v;
    });
    if (!preenchida) return;
    if (ajustar && spec.ajuste) Object.assign(dados, spec.ajuste.aplicar(dados));
    const cod = spec.codigo(dados);
    if (!cod || cod === "|") return;
    res.linhasLidas++;
    if (porCodigo.has(cod)) res.repetidas++;
    porCodigo.set(cod, { cod, nm: spec.nome(dados), dados });
  };
  try {
    // leitura direta (leve); só se o ZIP vier fora da especificação é que se usa o leitor reparado (usa muito mais memória)
    await paraCadaLinha(buffer, lerLinha, false);
  } catch (e) {
    if (n > 0) throw e;
    await paraCadaLinha(buffer, lerLinha, true);
  }
  if (!chaves) {
    res.erros.push(
      `Não encontrei o cabeçalho de "${spec.titulo}" no arquivo (esperava as colunas: ${spec.obrigatorias.join(", ")}). Confira se o arquivo é do cadastro certo.`
    );
    return res;
  }
  res.itens = [...porCodigo.values()];
  if (res.itens.length === 0) res.erros.push(`Nenhum registro de "${spec.titulo}" encontrado abaixo do cabeçalho.`);
  if (res.repetidas > 0) res.avisos.push(`${res.repetidas} linha(s) repetida(s) no arquivo (mesmo código) — valeu a última de cada.`);
  return res;
}

/** Lê a planilha de um cadastro: acha o cabeçalho, guarda todas as colunas por nome e junta repetidos pelo código. */
export function lerCadastro(buffer: ArrayBuffer, spec: CadastroSpec, ajustar = false): ResultadoCadastro {
  const res: ResultadoCadastro = { itens: [], linhasLidas: 0, repetidas: 0, avisos: [], erros: [] };
  // o cabeçalho do cadastro pode estar em qualquer aba (um arquivo com vários cadastros, um por aba)
  const wb = XLSX.read(buffer, { type: "array", cellDates: true });
  let linhas: unknown[][] = [];
  let idx = -1;
  let chaves: string[] = [];
  for (const aba of wb.SheetNames) {
    const daAba = XLSX.utils.sheet_to_json(wb.Sheets[aba], { header: 1, raw: true, defval: "" }) as unknown[][];
    for (let i = 0; i < Math.min(daAba.length, 25); i++) {
      const candidatas = chavesDoCabecalho(daAba[i]);
      if (spec.obrigatorias.every((k) => candidatas.includes(k))) {
        idx = i;
        chaves = candidatas;
        break;
      }
    }
    if (idx >= 0) {
      linhas = daAba;
      break;
    }
  }
  if (idx === -1) {
    res.erros.push(
      `Não encontrei o cabeçalho de "${spec.titulo}" no arquivo (esperava as colunas: ${spec.obrigatorias.join(", ")}). Confira se o arquivo é do cadastro certo.`
    );
    return res;
  }

  const porCodigo = new Map<string, { cod: string; nm: string; dados: DadosCadastro }>();
  for (const linha of linhas.slice(idx + 1)) {
    const dados: DadosCadastro = {};
    let preenchida = false;
    chaves.forEach((k, j) => {
      const v = valorDaCelula(linha[j]);
      if (v !== "") preenchida = true;
      dados[k] = v;
    });
    if (!preenchida) continue;
    if (ajustar && spec.ajuste) Object.assign(dados, spec.ajuste.aplicar(dados));
    const cod = spec.codigo(dados);
    // linhas de rodapé/totais não têm código
    if (!cod || cod === "|") continue;
    res.linhasLidas++;
    if (porCodigo.has(cod)) res.repetidas++;
    porCodigo.set(cod, { cod, nm: spec.nome(dados), dados });
  }

  res.itens = [...porCodigo.values()];
  if (res.itens.length === 0) res.erros.push(`Nenhum registro de "${spec.titulo}" encontrado abaixo do cabeçalho.`);
  if (res.repetidas > 0) {
    res.avisos.push(`${res.repetidas} linha(s) repetida(s) no arquivo (mesmo código) — valeu a última de cada.`);
  }
  return res;
}
