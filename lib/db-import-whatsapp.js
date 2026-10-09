import { auditar } from "./auditar";
import { codigoOperacao } from "./dashboard-atividades";
import { getPool } from "./db";
import { consultarOS, prepararAtividades } from "./db-atividades";
import { nomeOperacao, operacoesDoCadastro } from "./db-operacoes";
import { talhoesDaFazenda } from "./db-rodadas";

import semente from "./apontamentos-whatsapp-seed.json";

/** De-para "categoria da mensagem → operação", lembrado entre as importações. */
const CHAVE_DEPARA = "imp_whatsapp_ops";
async function lerDePara(exec) {
  return (await exec.query("SELECT valor FROM app_param WHERE chave = $1", [CHAVE_DEPARA])).rows[0]?.valor ?? {};
}

/** Operação de cada apontamento lido: a escrita na mensagem, senão a da O.S. (se tiver uma só), senão a do de-para. */
async function resolverOperacoes(pool, itens, dePara) {
  const cadOps = await operacoesDoCadastro(pool);
  const daOS = new Map();
  const res = [];
  for (const a of itens) {
    if (a.opCod) {
      res.push({ cod: a.opCod, ds: nomeOperacao(cadOps, a.opCod, a.atividade), origem: "mensagem" });
      continue;
    }
    if (a.os.length === 1) {
      if (!daOS.has(a.os[0])) {
        const c = await consultarOS(a.os[0]).catch(() => null);
        daOS.set(a.os[0], c && c.operacoes.length === 1 ? { cod: c.operacoes[0].cod, ds: c.operacoes[0].ds } : null);
      }
      const o = daOS.get(a.os[0]);
      if (o) {
        res.push({ ...o, origem: "os" });
        continue;
      }
    }
    const d = dePara[a.categoria];
    if (d?.cod) res.push({ cod: d.cod, ds: nomeOperacao(cadOps, d.cod, d.ds), origem: "depara" });
    else res.push({ cod: "", ds: a.categoria, origem: "" });
  }
  return res;
}

/** Fazendas do Cadastro de Fazenda pelo código base (9442 e 9442-1 → 9442). */
async function fazendasCadastro(exec) {
  const { rows } = await exec.query("SELECT cod, nm FROM cad_itm WHERE cad = 'fazendas' ORDER BY cod");
  const m = new Map();
  for (const r of rows) {
    const base = r.cod.split("-")[0].trim();
    if (!m.has(base)) m.set(base, r.nm);
  }
  return m;
}

/** Prévia da importação: o que é novo, o que já foi importado e a operação de cada um. */
export async function previaWhatsapp(itens) {
  const pool = getPool();
  await prepararAtividades(pool);
  const dePara = await lerDePara(pool);
  const ja = new Set(
    (await pool.query("SELECT orig_chave AS c FROM ap_dia WHERE orig_chave = ANY($1::text[])", [itens.map((i) => i.chave)])).rows.map((r) => r.c),
  );
  const ops = await resolverOperacoes(pool, itens, dePara);
  const faz = await fazendasCadastro(pool);
  const cats = new Map();
  for (const i of itens) {
    const c = cats.get(i.categoria) ?? { itens: 0, area: 0 };
    c.itens++;
    c.area = Math.round((c.area + i.area) * 100) / 100;
    cats.set(i.categoria, c);
  }
  const cadOps = await operacoesDoCadastro(pool);
  const usadas = (await pool.query("SELECT op_cod AS cod, MAX(op_ds) AS ds FROM ap_dia WHERE op_cod <> '' GROUP BY op_cod")).rows;
  const operacoes = new Map();
  for (const o of cadOps.values()) operacoes.set(codigoOperacao(o.cod), { cod: o.cod, ds: o.nm });
  for (const u of usadas) if (!operacoes.has(codigoOperacao(u.cod))) operacoes.set(codigoOperacao(u.cod), { cod: u.cod, ds: u.ds });
  return {
    itens: itens.map((i, k) => ({
      ...i,
      jaImportado: ja.has(i.chave),
      opCodFinal: ops[k].cod,
      opDsFinal: ops[k].ds,
      opOrigem: ops[k].origem,
      fazendas: Object.fromEntries([...new Set(i.talhoes.map((t) => t.faz))].map((f) => [f, faz.get(f) ?? ""])),
    })),
    categorias: [...cats.entries()].map(([categoria, v]) => ({ categoria, ...v })).sort((a, b) => b.area - a.area),
    dePara,
    operacoes: [...operacoes.values()].sort((a, b) => a.ds.localeCompare(b.ds)),
  };
}

const r2 = (n) => Math.round(n * 100) / 100;

/** Grava um apontamento lido (sem boletim; a origem e o texto da mensagem ficam guardados). */
async function gravarItem(client, a, op, faz, usuario) {
  const os = a.os.length === 1 ? a.os[0] : "";
  const obs = [
    `WhatsApp C.A.P.F.O · ${a.remetente} · mensagem de ${a.msgEm.slice(8, 10)}/${a.msgEm.slice(5, 7)} ${a.msgEm.slice(11)}`,
    a.equipe,
    a.atividade && a.atividade !== op.ds ? a.atividade : "",
    a.os.length > 1 ? `O.S. ${a.os.join(", ")}` : "",
    a.statusOs ? `Status da O.S.: ${a.statusOs}` : "",
    ...a.avisos,
  ]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 1500);
  const { rows } = await client.query(
    `INSERT INTO ap_dia (bol, dt, os, op_cod, op_ds, solic, etapa_cod, etapa_ds, tipo_apl, n_eqp, n_pes, obs, area_modo, eqp, vazao_uti, vol_calda, usr,
                         orig, orig_chave, orig_msg)
     VALUES (NULL, $1, $2, $3, $4, '', '', '', '', $5, $6, $7, 'talhao', $8, $9, $10, $11, 'whatsapp', $12, $13)
     RETURNING id`,
    [a.dt, os, op.cod, op.ds, a.nEqp, a.nPes, obs, a.frota, a.vazao, a.calda, usuario, a.chave, a.texto.slice(0, 8000)],
  );
  const id = rows[0].id;
  // talhão como está no cadastro da fazenda ("1" = "01"); repetido na mensagem entra uma vez
  const vistos = new Set();
  for (const f of [...new Set(a.talhoes.map((t) => t.faz))]) {
    const cadastro = await talhoesDaFazenda(f);
    for (const t of a.talhoes.filter((x) => x.faz === f)) {
      const doCad = t.tlh ? cadastro.find((c) => c.tlh.replace(/^0+(?=\d)/, "") === t.tlh.replace(/^0+(?=\d)/, "")) : undefined;
      const tlh = doCad?.tlh ?? t.tlh;
      const k = `${f}|${tlh}`;
      if (vistos.has(k)) {
        // área sem talhão (carreador + total) soma; talhão repetido já foi tratado na leitura
        if (!tlh) await client.query("UPDATE ap_dia_tlh SET area = area + $3 WHERE ap_id = $1 AND prop_cod = $2 AND tlh = ''", [id, f, r2(t.area)]);
        continue;
      }
      vistos.add(k);
      await client.query("INSERT INTO ap_dia_tlh (ap_id, prop_cod, prop_nm, tlh, area_tlh, area) VALUES ($1, $2, $3, $4, $5, $6)", [
        id,
        f,
        faz.get(f) ?? "",
        tlh,
        doCad?.area ?? null,
        r2(t.area),
      ]);
    }
  }
  return id;
}

/**
 * Grava os apontamentos lidos da conversa: os já importados (mesma mensagem) ficam de fora — ou, com `atualizarOperacao`,
 * só têm a operação refeita pelo de-para, se ninguém alterou o apontamento depois. O de-para usado fica lembrado.
 */
export async function importarWhatsapp(itens, dePara, usuario, opcoes = {}) {
  const pool = getPool();
  await prepararAtividades(pool);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('ap_dia_import_whatsapp'))");
    const antigo = await lerDePara(client);
    const novoDePara = { ...antigo, ...dePara };
    if (Object.keys(dePara).length)
      await client.query(
        `INSERT INTO app_param (chave, valor, atu_usr, atu_em) VALUES ($1, $2::jsonb, $3, now())
         ON CONFLICT (chave) DO UPDATE SET valor = EXCLUDED.valor, atu_usr = EXCLUDED.atu_usr, atu_em = now()`,
        [CHAVE_DEPARA, JSON.stringify(novoDePara), usuario],
      );
    const ops = await resolverOperacoes(pool, itens, novoDePara);
    const faz = await fazendasCadastro(client);
    const existentes = new Map(
      (
        await client.query("SELECT orig_chave AS c, id, atu_em IS NOT NULL AS editado FROM ap_dia WHERE orig_chave = ANY($1::text[])", [
          itens.map((i) => i.chave),
        ])
      ).rows.map((r) => [r.c, r]),
    );
    let novos = 0;
    let atualizados = 0;
    let area = 0;
    for (const [k, a] of itens.entries()) {
      const ex = existentes.get(a.chave);
      if (ex) {
        if (opcoes.atualizarOperacao && !ex.editado && ops[k].cod) {
          const r = await client.query("UPDATE ap_dia SET op_cod = $2, op_ds = $3 WHERE id = $1 AND (op_cod <> $2 OR op_ds <> $3)", [
            ex.id,
            ops[k].cod,
            ops[k].ds,
          ]);
          atualizados += r.rowCount ?? 0;
        }
        continue;
      }
      await gravarItem(client, a, ops[k], faz, usuario);
      novos++;
      area += a.area;
    }
    await auditar(client, {
      usuario,
      modulo: "Atividades",
      entidade: "Apontamento diário",
      chave: opcoes.marca ?? `Importação do WhatsApp · ${itens.length} apontamento(s) lido(s)`,
      acao: "importacao",
      depois: {
        novos,
        jaImportados: itens.length - novos,
        operacaoAtualizada: atualizados || undefined,
        area: r2(area),
        periodo: itens.length
          ? `${[...itens].map((i) => i.dt).sort()[0]} a ${[...itens]
              .map((i) => i.dt)
              .sort()
              .pop()}`
          : undefined,
        dePara: Object.keys(dePara).length ? dePara : undefined,
      },
    });
    await client.query("COMMIT");
    return { novos, jaImportados: itens.length - novos, atualizados, area: r2(area) };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

const MARCA_CARGA = "Carga inicial · WhatsApp C.A.P.F.O desde 01/10/2026";
let carga = null;

/** Primeira carga (uma vez): apontamentos da conversa do grupo C.A.P.F.O com operação a partir de 01/10/2026. */
export async function carregarApontamentosWhatsappIniciais() {
  if (!carga) {
    carga = (async () => {
      const pool = getPool();
      await prepararAtividades(pool);
      const feita =
        ((await pool.query("SELECT 1 FROM aud_log WHERE modulo = 'Atividades' AND entidade = 'Apontamento diário' AND chave = $1 LIMIT 1", [MARCA_CARGA]))
          .rowCount ?? 0) > 0;
      if (feita) return;
      await importarWhatsapp(semente, {}, "Carga inicial", { marca: MARCA_CARGA });
    })().catch((err) => {
      carga = null;
      console.error("Carga inicial dos apontamentos do WhatsApp não concluída:", err);
    });
  }
  await carga;
}
