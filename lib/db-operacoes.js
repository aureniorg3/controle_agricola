import { codigoOperacao } from "./dashboard-atividades";
import { carregarCadastrosExportados } from "./db-cadastros-carga";

/**
 * Operações do cadastro (Configurações › Cadastros › Operações), pelo código sem zeros à esquerda: é de lá que vem o nome
 * da operação em todo o sistema. Código que não está no cadastro continua com a descrição que veio da sua origem.
 */
export async function operacoesDoCadastro(pool) {
  await carregarCadastrosExportados(pool);
  const { rows } = await pool.query("SELECT cod, nm, dds->>'codigo_2_nm' AS cls, dds->>'codigo_da_etapa' AS etapa FROM cad_itm WHERE cad = 'operacoes'");
  return new Map(rows.map((r) => [codigoOperacao(r.cod), { cod: r.cod, nm: r.nm, classificacao: r.cls ?? "", etapaCod: r.etapa ?? "" }]));
}

/** Nome da operação pelo cadastro; sem ela no cadastro, a descrição de origem. */
export function nomeOperacao(cadastro, cod, origem) {
  return cadastro.get(codigoOperacao(cod))?.nm || origem;
}
