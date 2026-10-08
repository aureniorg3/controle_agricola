import type { Pool } from "pg";
import { codigoOperacao } from "./dashboard-atividades";
import { carregarCadastrosExportados } from "./db-cadastros-carga";

export interface OperacaoCadastro {
  cod: string;
  nm: string;
  /** Classificação de Operações (Mecanizada, Manual…) */
  classificacao: string;
  etapaCod: string;
}

/**
 * Operações do cadastro (Configurações › Cadastros › Operações), pelo código sem zeros à esquerda: é de lá que vem o nome
 * da operação em todo o sistema. Código que não está no cadastro continua com a descrição que veio da sua origem.
 */
export async function operacoesDoCadastro(pool: Pool): Promise<Map<string, OperacaoCadastro>> {
  await carregarCadastrosExportados(pool);
  const { rows } = await pool.query<{ cod: string; nm: string; cls: string | null; etapa: string | null }>(
    "SELECT cod, nm, dds->>'codigo_2_nm' AS cls, dds->>'codigo_da_etapa' AS etapa FROM cad_itm WHERE cad = 'operacoes'"
  );
  return new Map(
    rows.map((r) => [codigoOperacao(r.cod), { cod: r.cod, nm: r.nm, classificacao: r.cls ?? "", etapaCod: r.etapa ?? "" }])
  );
}

/** Nome da operação pelo cadastro; sem ela no cadastro, a descrição de origem. */
export function nomeOperacao(cadastro: Map<string, OperacaoCadastro>, cod: string, origem: string): string {
  return cadastro.get(codigoOperacao(cod))?.nm || origem;
}
