import { readFileSync } from "node:fs";
import path from "node:path";
import { gunzipSync } from "node:zlib";
import { auditar } from "./auditar";
import { specPorSlug } from "./cadastros-spec";
import { getPool, prepararBanco } from "./db";
import semente from "./cadastros-export-seed.json";

/** Cadastros com carga inicial dos relatórios exportados do sistema (ExportWWT…) e da planilha de Ocupações. */
export const CADASTROS_COM_CARGA_EXPORTADA = ["classificacao-operacoes", "tipos-despesa", "operacoes", "tipo-aplicacao", "ocupacao", "tipo-propriedade", "fazendas"];

/**
 * Tipo Propriedade: os códigos da coluna "Classificação Proprietário" do Cadastro de Propriedade (P, R e F). R é a
 * parceria (as fazendas R usam a taxa "NF CANA PARCERIA"); as descrições podem ser trocadas no cadastro.
 */
const CARGA_TIPO_PROPRIEDADE = {
  arquivo: "Classificação Proprietário do Cadastro de Propriedade",
  itens: [
    { cod: "P", nm: "PRÓPRIO", dds: { codigo: "P", descricao: "PRÓPRIO" } },
    { cod: "R", nm: "PARCERIA", dds: { codigo: "R", descricao: "PARCERIA" } },
    { cod: "F", nm: "FORNECEDOR", dds: { codigo: "F", descricao: "FORNECEDOR" } },
  ],
};

let preparado = null;

/**
 * Carga única de Classificação de Operações, Tipos de Despesa, Operações e Tipo Aplicação a partir dos relatórios
 * exportados do sistema (e de Ocupação, da planilha "01 - Ocupações Talhões - Áreas"). Roda uma vez por cadastro (o log guarda a marca) e nunca sobrescreve o que já existe.
 * Antes, o Tipo Aplicação passa a ter código + descrição como chave (o relatório repete códigos com descrições diferentes).
 */
export async function carregarCadastrosExportados(pool = getPool()) {
  await prepararBanco(pool);
  if (!preparado) {
    preparado = (async () => {
      await pool.query(
        `UPDATE cad_itm t SET cod = t.cod || '|' || t.nm
          WHERE t.cad = 'tipo-aplicacao' AND position('|' in t.cod) = 0
            AND NOT EXISTS (SELECT 1 FROM cad_itm x WHERE x.cad = 'tipo-aplicacao' AND x.cod = t.cod || '|' || t.nm)`,
      );
      const cargas = { ...semente, "tipo-propriedade": CARGA_TIPO_PROPRIEDADE };
      for (const [cad, { arquivo, itens }] of Object.entries(cargas)) {
        const entidade = `Cadastro de ${specPorSlug(cad)?.titulo ?? cad}`;
        const marca = `Carga inicial · ${arquivo}`;
        try {
          const marcada = async (exec) =>
            ((await exec.query("SELECT 1 FROM aud_log WHERE modulo = 'Cadastros' AND entidade = $1 AND chave = $2 LIMIT 1", [entidade, marca])).rowCount ?? 0) >
            0;
          if (await marcada(pool)) continue;
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`carga_${cad}`]);
            if (await marcada(client)) {
              await client.query("ROLLBACK");
              continue;
            }
            const r = await client.query(
              `INSERT INTO cad_itm (cad, cod, nm, dds, usr, atu_usr)
               SELECT $1, x.cod, x.nm, x.dds, 'Carga inicial', 'Carga inicial' FROM jsonb_to_recordset($2::jsonb) AS x(cod text, nm text, dds jsonb)
               ON CONFLICT (cad, cod) DO NOTHING`,
              [cad, JSON.stringify(itens)],
            );
            await auditar(client, {
              usuario: "Carga inicial",
              modulo: "Cadastros",
              entidade,
              chave: marca,
              acao: "importacao",
              depois: { naPlanilha: itens.length, carregados: r.rowCount ?? 0 },
            });
            await client.query("COMMIT");
          } catch (err) {
            await client.query("ROLLBACK");
            throw err;
          } finally {
            client.release();
          }
        } catch (err) {
          console.error(`Carga inicial de ${cad} não concluída:`, err);
        }
      }
    })().catch((err) => {
      preparado = null;
      throw err;
    });
  }
  await preparado;
}

// ---------------------------------------------------------------------------
// Equipamentos (Cadastros › Equipamentos): carga inicial dos relatórios do sistema de frota
// ---------------------------------------------------------------------------

/** Cadastros de Equipamentos, na ordem da carga (os referenciados pelos Veículos antes deles). */
export const CADASTROS_EQUIPAMENTOS = ["tipos-combustivel", "marcas", "modelos", "especialidades", "veiculos"];

let equipamentos = null;

/**
 * Carga única dos cadastros de Equipamentos a partir dos relatórios exportados do sistema de frota (Tipos de
 * Combustíveis, Marcas, Modelos, Especialidades e Veículos, com todas as colunas): uma vez por cadastro (o log guarda a
 * marca), nunca sobrescreve o que já existe. Especialidade bloqueada e veículo com Ativo diferente de S entram
 * inativos. Os veículos (o arquivo grande) ficam compactados em lib/veiculos-seed.json.gz e só são lidos na carga.
 */
export async function carregarEquipamentos(pool = getPool()) {
  await prepararBanco(pool);
  if (!equipamentos) {
    equipamentos = (async () => {
      const pequenos = (await import("./equipamentos-seed.json")).default;
      for (const cad of CADASTROS_EQUIPAMENTOS) {
        const entidade = `Cadastro de ${specPorSlug(cad)?.titulo ?? cad}`;
        const arquivo = cad === "veiculos" ? "ExportWWTFR02TExportToExcel" : pequenos[cad].arquivo;
        const marca = `Carga inicial · ${arquivo}`;
        const marcada = async (exec) =>
          ((await exec.query("SELECT 1 FROM aud_log WHERE modulo = 'Cadastros' AND entidade = $1 AND chave = $2 LIMIT 1", [entidade, marca])).rowCount ?? 0) > 0;
        try {
          if (await marcada(pool)) continue;
          const itens =
            cad === "veiculos"
              ? JSON.parse(gunzipSync(readFileSync(path.join(process.cwd(), "lib", "veiculos-seed.json.gz"))).toString("utf8")).itens
              : pequenos[cad].itens;
          const client = await pool.connect();
          try {
            await client.query("BEGIN");
            await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`carga_${cad}`]);
            if (await marcada(client)) {
              await client.query("ROLLBACK");
              continue;
            }
            let carregados = 0;
            // em lotes, para o JSON de cada consulta não ficar enorme
            for (let i = 0; i < itens.length; i += 1000) {
              const r = await client.query(
                `INSERT INTO cad_itm (cad, cod, nm, dds, atv, usr, atu_usr)
                 SELECT $1, x.cod, x.nm, x.dds, COALESCE(x.atv, true), 'Carga inicial', 'Carga inicial'
                   FROM jsonb_to_recordset($2::jsonb) AS x(cod text, nm text, dds jsonb, atv boolean)
                 ON CONFLICT (cad, cod) DO NOTHING`,
                [cad, JSON.stringify(itens.slice(i, i + 1000))],
              );
              carregados += r.rowCount ?? 0;
            }
            await auditar(client, {
              usuario: "Carga inicial",
              modulo: "Cadastros",
              entidade,
              chave: marca,
              acao: "importacao",
              depois: { naPlanilha: itens.length, carregados, inativos: itens.filter((x) => x.atv === false).length || undefined },
            });
            await client.query("COMMIT");
          } catch (err) {
            await client.query("ROLLBACK");
            throw err;
          } finally {
            client.release();
          }
        } catch (err) {
          console.error(`Carga inicial de ${cad} não concluída:`, err);
        }
      }
    })().catch((err) => {
      equipamentos = null;
      throw err;
    });
  }
  await equipamentos;
}

let complemento = null;
const MARCA_COMPLEMENTO = "Carga inicial · dados de aplicação dos insumos (t_ins.xls)";

/**
 * Completa uma vez o cadastro Material e Insumos com os dados de aplicação do arquivo t_ins.xls (nome comercial,
 * princípio ativo, concentração, classe agronômica, categoria e unidade de aplicação), pelo código do item. Itens que
 * não estão no cadastro ficam de fora (e vão para o log); depois, a manutenção é feita na própria linha do cadastro.
 */
export async function carregarComplementoInsumos(pool = getPool()) {
  await prepararBanco(pool);
  if (!complemento) {
    complemento = (async () => {
      const entidade = "Cadastro de Material e Insumos";
      const marcada = async (exec) =>
        ((await exec.query("SELECT 1 FROM aud_log WHERE modulo = 'Cadastros' AND entidade = $1 AND chave = $2 LIMIT 1", [entidade, MARCA_COMPLEMENTO]))
          .rowCount ?? 0) > 0;
      if (await marcada(pool)) return;
      // sem o cadastro importado ainda não há o que completar: tenta de novo na próxima vez
      const n = (await pool.query("SELECT COUNT(*)::int AS n FROM cad_itm WHERE cad = 'materiais-insumos'")).rows[0].n;
      if (n === 0) {
        complemento = null;
        return;
      }
      const { itens } = (await import("./insumos-complemento-seed.json")).default;
      const lista = Object.entries(itens).map(([cod, dds]) => ({ cod, dds }));
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(hashtext('carga_complemento_insumos'))");
        if (await marcada(client)) {
          await client.query("ROLLBACK");
          return;
        }
        const r = await client.query(
          `UPDATE cad_itm c SET dds = c.dds || x.dds, atu_em = now(), atu_usr = 'Carga inicial'
             FROM jsonb_to_recordset($1::jsonb) AS x(cod text, dds jsonb)
            WHERE c.cad = 'materiais-insumos' AND ltrim(c.cod, '0') = ltrim(x.cod, '0')
           RETURNING x.cod`,
          [JSON.stringify(lista)],
        );
        const achados = new Set(r.rows.map((x) => x.cod));
        const fora = lista.filter((i) => !achados.has(i.cod));
        await auditar(client, {
          usuario: "Carga inicial",
          modulo: "Cadastros",
          entidade,
          chave: MARCA_COMPLEMENTO,
          acao: "importacao",
          depois: {
            noArquivo: lista.length,
            completados: achados.size,
            foraDoCadastro: fora.length ? fora.map((i) => `${i.cod} ${i.dds.nome_comercial ?? ""}`.trim()) : undefined,
          },
        });
        await client.query("COMMIT");
      } catch (err) {
        await client.query("ROLLBACK");
        throw err;
      } finally {
        client.release();
      }
    })().catch((err) => {
      complemento = null;
      console.error("Carga dos dados de aplicação dos insumos não concluída:", err);
    });
  }
  await complemento;
}
