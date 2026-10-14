import { auditar } from "./auditar";
import { getPool } from "./db";
import { consultarOS, prepararAtividades } from "./db-atividades";
import { nomeOperacao, operacoesDoCadastro } from "./db-operacoes";
import { talhoesDaFazenda } from "./db-rodadas";

import semente from "./apontamentos-whatsapp-seed.json";

/** De-para "categoria da mensagem → operação" gravado pelas importações da conversa feitas antes (só leitura). */
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

const r2 = (n) => Math.round(n * 100) / 100;

/**
 * Grava um apontamento lido (sem boletim; a origem e o texto da mensagem ficam guardados).
 * Com `idExistente` (mensagem editada no grupo, vinda do bot) regrava o mesmo apontamento.
 */
async function gravarItem(client, a, op, faz, usuario, idExistente) {
  const os = a.os.length === 1 ? a.os[0] : "";
  const obs = [
    `WhatsApp ${a.grupo || "C.A.P.F.O"} · ${a.remetente} · mensagem de ${a.msgEm.slice(8, 10)}/${a.msgEm.slice(5, 7)} ${a.msgEm.slice(11)}`,
    a.equipe,
    a.atividade && a.atividade !== op.ds ? a.atividade : "",
    a.os.length > 1 ? `O.S. ${a.os.join(", ")}` : "",
    a.statusOs ? `Status da O.S.: ${a.statusOs}` : "",
    a.observacao ?? "",
    ...a.avisos,
  ]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 1500);
  // solicitante, etapa (só a descrição: o código fica para quem conferir), tipo de aplicação e vazão
  // recomendada vêm só do bot; a carga inicial não tem
  const valores = [a.dt, os, op.cod, op.ds, (a.solicitante ?? "").slice(0, 120), (a.etapa ?? "").slice(0, 120), (a.tipoAplicacao ?? "").slice(0, 120),
    a.nEqp, a.nPes, obs, a.frota, a.vazaoRec ?? null, a.vazao, a.calda, usuario, a.chave, a.texto.slice(0, 8000)];
  let id = idExistente;
  if (id) {
    await client.query(
      `UPDATE ap_dia SET dt=$1, os=$2, op_cod=$3, op_ds=$4, solic=$5, etapa_ds=$6, tipo_apl=$7, n_eqp=$8, n_pes=$9, obs=$10, eqp=$11,
              vazao_rec=$12, vazao_uti=$13, vol_calda=$14, atu_usr=$15, atu_em=now(), orig_chave=$16, orig_msg=$17 WHERE id=$18`,
      [...valores, id],
    );
    await client.query("DELETE FROM ap_dia_tlh WHERE ap_id = $1", [id]);
  } else {
    const { rows } = await client.query(
      `INSERT INTO ap_dia (bol, dt, os, op_cod, op_ds, solic, etapa_cod, etapa_ds, tipo_apl, n_eqp, n_pes, obs, area_modo, eqp, vazao_rec, vazao_uti, vol_calda, usr,
                           orig, orig_chave, orig_msg)
       VALUES (NULL, $1, $2, $3, $4, $5, '', $6, $7, $8, $9, $10, 'talhao', $11, $12, $13, $14, $15, 'whatsapp', $16, $17)
       RETURNING id`,
      valores,
    );
    id = rows[0].id;
  }
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

/** Grava os apontamentos da carga inicial: os já importados (mesma mensagem) ficam de fora. */
async function importarWhatsapp(itens, usuario, marca) {
  const pool = getPool();
  await prepararAtividades(pool);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('ap_dia_import_whatsapp'))");
    const ops = await resolverOperacoes(pool, itens, await lerDePara(client));
    const faz = await fazendasCadastro(client);
    const existentes = new Set(
      (await client.query("SELECT orig_chave AS c FROM ap_dia WHERE orig_chave = ANY($1::text[])", [itens.map((i) => i.chave)])).rows.map((r) => r.c),
    );
    let novos = 0;
    let area = 0;
    for (const [k, a] of itens.entries()) {
      if (existentes.has(a.chave)) continue;
      await gravarItem(client, a, ops[k], faz, usuario);
      novos++;
      area += a.area;
    }
    await auditar(client, {
      usuario,
      modulo: "Atividades",
      entidade: "Apontamento diário",
      chave: marca,
      acao: "importacao",
      depois: {
        novos,
        jaImportados: itens.length - novos,
        area: r2(area),
        periodo: itens.length
          ? `${[...itens].map((i) => i.dt).sort()[0]} a ${[...itens]
              .map((i) => i.dt)
              .sort()
              .pop()}`
          : undefined,
      },
    });
    await client.query("COMMIT");
    return { novos, jaImportados: itens.length - novos, area: r2(area) };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Mensagens de produção lidas pelo bot do WhatsApp (o app de disponibilidade da frota manda; ver
 * app/api/integracao/whatsapp). Tudo entra, como no app de lá: nova → apontamento sem boletim; editada no
 * grupo → regrava o mesmo; apagada no grupo (ou que deixou de ser relatório) → sai. Apontamento que já
 * ganhou boletim (alguém conferiu e lançou) não é mais mexido pelo bot.
 */
export async function sincronizarDoBot(itens) {
  const pool = getPool();
  await prepararAtividades(pool);
  const client = await pool.connect();
  const res = [];
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('ap_dia_import_whatsapp'))");
    const vivos = itens.filter((i) => !i.apagada);
    const ops = await resolverOperacoes(pool, vivos, await lerDePara(client));
    const faz = await fazendasCadastro(client);
    const existentes = new Map(
      (await client.query("SELECT id, bol, orig_chave AS c FROM ap_dia WHERE orig_chave = ANY($1::text[])", [itens.map((i) => i.chave)])).rows.map((r) => [
        r.c,
        r,
      ]),
    );
    const cont = { novos: 0, atualizados: 0, removidos: 0, conferidos: 0 };
    for (const a of itens) {
      const ex = existentes.get(a.chave);
      if (ex && ex.bol !== null) {
        res.push({ chave: a.chave, id: ex.id, acao: "conferido" });
        cont.conferidos++;
      } else if (a.apagada) {
        if (ex) await client.query("DELETE FROM ap_dia WHERE id = $1", [ex.id]);
        res.push({ chave: a.chave, id: null, acao: ex ? "removido" : "nada" });
        if (ex) cont.removidos++;
      } else {
        const id = await gravarItem(client, a, ops[vivos.indexOf(a)], faz, "Bot WhatsApp", ex?.id);
        res.push({ chave: a.chave, id, acao: ex ? "atualizado" : "novo" });
        cont[ex ? "atualizados" : "novos"]++;
      }
    }
    if (cont.novos || cont.atualizados || cont.removidos)
      await auditar(client, { usuario: "Bot WhatsApp", modulo: "Atividades", entidade: "Apontamento diário", chave: "WhatsApp (bot)", acao: "importacao", depois: cont });
    await client.query("COMMIT");
    return res;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

const MARCA_CARGA ="Carga inicial · WhatsApp C.A.P.F.O desde 01/10/2026";
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
      await importarWhatsapp(semente, "Carga inicial", MARCA_CARGA);
    })().catch((err) => {
      carga = null;
      console.error("Carga inicial dos apontamentos do WhatsApp não concluída:", err);
    });
  }
  await carga;
}
