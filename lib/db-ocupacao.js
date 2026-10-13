import { getPool } from "./db";
import { carregarCadastrosExportados } from "./db-cadastros-carga";
import { OCUPACOES_PADRAO, ocupacaoDoItem } from "./ocupacao";

/** Faixas do cadastro Ocupação (com a carga inicial garantida); cadastro vazio = as faixas da planilha original. */
export async function ocupacoesDoCadastro(pool = getPool()) {
  await carregarCadastrosExportados(pool);
  const { rows } = await pool.query("SELECT cod, nm, dds FROM cad_itm WHERE cad = 'ocupacao' ORDER BY cod");
  if (rows.length === 0) return OCUPACOES_PADRAO;
  return rows.map((r) => ocupacaoDoItem(r.cod, r.nm, r.dds));
}
