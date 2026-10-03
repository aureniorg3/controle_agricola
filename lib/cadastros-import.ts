import { dataIso, lerLinhas } from "./import-pesagem";
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

/** Lê a planilha de um cadastro: acha o cabeçalho, guarda todas as colunas por nome e junta repetidos pelo código. */
export function lerCadastro(buffer: ArrayBuffer, spec: CadastroSpec): ResultadoCadastro {
  const res: ResultadoCadastro = { itens: [], linhasLidas: 0, repetidas: 0, avisos: [], erros: [] };
  const linhas = lerLinhas(buffer);

  let idx = -1;
  let chaves: string[] = [];
  for (let i = 0; i < Math.min(linhas.length, 25); i++) {
    const candidatas = chavesDoCabecalho(linhas[i]);
    if (spec.obrigatorias.every((k) => candidatas.includes(k))) {
      idx = i;
      chaves = candidatas;
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
