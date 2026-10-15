import { ratearArea } from "./atividades";
import { auditar } from "./auditar";
import { getPool } from "./db";
import { BOT_WHATSAPP, consultarOS, prepararAtividades } from "./db-atividades";
import { nomeOperacao, operacoesDoCadastro } from "./db-operacoes";
import { talhoesDaFazenda } from "./db-rodadas";
import { normFaz, normTlh } from "./ocupacao";

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
 * Com `idExistente` (mensagem editada no grupo, vinda do bot) regrava o mesmo apontamento, só se ninguém o conferiu nem
 * alterou; senão devolve null e ele fica como a pessoa deixou (talhões também).
 */
async function gravarItem(client, a, op, faz, usuario, idExistente) {
  // sem zeros à esquerda, como a base de O.S. (a O.S. que ainda não está na base casa com ela quando for importada)
  const os = a.os.length === 1 ? String(a.os[0]).trim().replace(/^0+(?=\d)/, "") : "";
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
  // apontador / informante: quem mandou a mensagem no grupo
  const valores = [a.dt, os, op.cod, op.ds, (a.solicitante ?? "").slice(0, 120), (a.etapa ?? "").slice(0, 120), (a.tipoAplicacao ?? "").slice(0, 120),
    a.nEqp, a.nPes, obs, a.frota, a.vazaoRec ?? null, a.vazao, a.calda, usuario, a.chave, a.texto.slice(0, 8000), (a.remetente ?? "").slice(0, 80)];
  let id = idExistente;
  if (id) {
    // conferido ou alterado por uma pessoa depois de lido (a mesma regra de sincronizarDoBot): não regrava
    const r = await client.query(
      `UPDATE ap_dia SET dt=$1, os=$2, op_cod=$3, op_ds=$4, solic=$5, etapa_ds=$6, tipo_apl=$7, n_eqp=$8, n_pes=$9, obs=$10, eqp=$11,
              vazao_rec=$12, vazao_uti=$13, vol_calda=$14, atu_usr=$15, atu_em=now(), orig_chave=$16, orig_msg=$17, apont=$18
        WHERE id=$19 AND conf_em IS NULL AND COALESCE(atu_usr, '') IN ('', $20)`,
      [...valores, id, BOT_WHATSAPP],
    );
    if (!r.rowCount) return null;
    await client.query("DELETE FROM ap_dia_tlh WHERE ap_id = $1", [id]);
  } else {
    const { rows } = await client.query(
      `INSERT INTO ap_dia (bol, dt, os, op_cod, op_ds, solic, etapa_cod, etapa_ds, tipo_apl, n_eqp, n_pes, obs, area_modo, eqp, vazao_rec, vazao_uti, vol_calda, usr,
                           orig, orig_chave, orig_msg, apont)
       VALUES (NULL, $1, $2, $3, $4, $5, '', $6, $7, $8, $9, $10, 'talhao', $11, $12, $13, $14, $15, 'whatsapp', $16, $17, $18)
       RETURNING id`,
      valores,
    );
    id = rows[0].id;
  }
  // talhões já encaixados na O.S. (bot: encaixarNaOS) entram como estão
  if (a.linhas) {
    for (const t of a.linhas)
      await client.query("INSERT INTO ap_dia_tlh (ap_id, prop_cod, prop_nm, tlh, area_tlh, area) VALUES ($1, $2, $3, $4, $5, $6)", [
        id,
        t.propCod,
        t.propNm || faz.get(normFaz(t.propCod)) || "",
        t.tlh,
        t.areaTlh ?? null,
        r2(t.area),
      ]);
    return id;
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
    // já importados, ou excluídos por uma pessoa depois de importados
    const existentes = new Set(
      (
        await client.query(
          "SELECT orig_chave AS c FROM ap_dia WHERE orig_chave = ANY($1::text[]) UNION SELECT orig_chave FROM ap_dia_exc WHERE orig_chave = ANY($1::text[])",
          [itens.map((i) => i.chave)],
        )
      ).rows.map((r) => r.c),
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
 * app/api/integracao/whatsapp). Tudo entra, como no app de lá: nova → apontamento com o próximo nº de
 * boletim; editada no grupo → regrava o mesmo (mesmo boletim); apagada no grupo (ou que deixou de ser
 * relatório) → sai. Apontamento que alguém alterou ou conferiu aqui (atu_usr de uma pessoa, conf_em) não é mais
 * mexido pelo bot; o que alguém excluiu (ap_dia_exc) não volta.
 */
const BOT = BOT_WHATSAPP;

/**
 * Relatório com uma O.S. que está na base: a operação e os talhões passam a ser os da O.S. (mesmas chaves que o
 * formulário usa, então a área aparece em cada talhão e conta no "Já apontado"). Talhão da mensagem casa pelo
 * número ("01" = "1"); a área de uma fazenda sem talhões na mensagem (só o total) é rateada entre os talhões da
 * O.S. naquela fazenda que a mensagem não citou, pela área recomendada (senão a do talhão), como o rateio do
 * lançamento. Talhão fora da O.S. fica como veio, com aviso. null: sem O.S. na base (segue como antes); sem `op`: a
 * O.S. está na base, mas a operação da mensagem não encaixa (valem só o código e o responsável da O.S.).
 */
async function encaixarNaOS(a, op) {
  if (a.os.length !== 1) return null;
  const info = await consultarOS(a.os[0], undefined, a.dt).catch(() => null);
  if (!info) return null;
  const n = (c) => String(c ?? "").trim().replace(/^0+(?=\d)/, "");
  const avisos = [];
  let o = op.cod ? info.operacoes.find((x) => n(x.cod) === n(op.cod)) : undefined;
  if (!o && info.operacoes.length === 1) {
    o = info.operacoes[0];
    if (op.cod) avisos.push(`Operação ${op.cod} da mensagem não está na O.S. ${info.os}; usada a ${o.cod} da O.S.`);
  }
  if (!o) return { os: info.os, resp: info.resp ?? "" };
  const linhas = [];
  const somar = (x, area) => {
    const l = linhas.find((y) => y.propCod === x.propCod && y.tlh === x.tlh);
    if (l) l.area += area;
    else linhas.push({ propCod: x.propCod, propNm: x.propNm, tlh: x.tlh, areaTlh: x.areaTlh ?? null, area });
  };
  for (const f of [...new Set(a.talhoes.map((t) => t.faz))]) {
    const daOS = o.talhoes.filter((t) => normFaz(t.propCod) === normFaz(f));
    const citados = new Set();
    let semTalhao = 0;
    for (const t of a.talhoes.filter((x) => x.faz === f)) {
      if (!t.tlh) {
        semTalhao += t.area;
        continue;
      }
      const x = daOS.find((y) => normTlh(y.tlh) === normTlh(t.tlh));
      if (x) {
        somar(x, t.area);
        citados.add(x.tlh);
      } else {
        somar({ propCod: f, propNm: daOS[0]?.propNm ?? "", tlh: normTlh(t.tlh) }, t.area);
        if (daOS.length) avisos.push(`Talhão ${f}-${t.tlh} não está na O.S. ${info.os}.`);
      }
    }
    if (semTalhao > 0) {
      const resto = daOS.filter((y) => !citados.has(y.tlh));
      if (resto.length) ratearArea(semTalhao, resto.map((y) => y.areaRec ?? y.areaTlh)).forEach((ar, i) => ar > 0 && somar(resto[i], ar));
      else somar({ propCod: f, propNm: "", tlh: "" }, semTalhao);
    }
  }
  return { os: info.os, op: { cod: o.cod, ds: o.ds }, linhas, avisos, resp: info.resp ?? "" };
}

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
    // travados até o fim: a conferência ou a edição de uma pessoa que chegar no meio espera o bot (e a conferência vê que
    // o apontamento mudou desde a análise); a que chegou antes já está no que foi lido aqui
    const existentes = new Map(
      (
        await client.query("SELECT id, bol, atu_usr, conf_em, orig_chave AS c FROM ap_dia WHERE orig_chave = ANY($1::text[]) FOR UPDATE", [
          itens.map((i) => i.chave),
        ])
      ).rows.map((r) => [r.c, r]),
    );
    // mensagens cujo apontamento uma pessoa excluiu aqui: não voltam, mesmo editadas no grupo
    const excluidos = new Set(
      (await client.query("SELECT orig_chave AS c FROM ap_dia_exc WHERE orig_chave = ANY($1::text[])", [itens.map((i) => i.chave)])).rows.map((r) => r.c),
    );
    const cont = { novos: 0, atualizados: 0, removidos: 0, conferidos: 0, excluidos: 0 };
    for (const a of itens) {
      const ex = existentes.get(a.chave);
      if (!ex && excluidos.has(a.chave)) {
        res.push({ chave: a.chave, id: null, acao: "excluido" });
        cont.excluidos++;
      } else if (ex && (ex.conf_em || (ex.atu_usr && ex.atu_usr !== BOT))) {
        // conferido ou alterado por uma pessoa: fica como ela deixou
        res.push({ chave: a.chave, id: ex.id, acao: "conferido" });
        cont.conferidos++;
      } else if (a.apagada) {
        const del = ex
          ? await client.query("DELETE FROM ap_dia WHERE id = $1 AND conf_em IS NULL AND COALESCE(atu_usr, '') IN ('', $2)", [ex.id, BOT])
          : null;
        if (ex && !del.rowCount) {
          // conferido ou alterado por uma pessoa depois de lido: fica
          res.push({ chave: a.chave, id: ex.id, acao: "conferido" });
          cont.conferidos++;
          continue;
        }
        res.push({ chave: a.chave, id: null, acao: ex ? "removido" : "nada" });
        if (ex) cont.removidos++;
      } else {
        let op = ops[vivos.indexOf(a)];
        const enc = await encaixarNaOS(a, op);
        // O.S. na base: gravada como está nela (sem zeros à esquerda) e, sem solicitante na mensagem, vale o responsável
        // da O.S. (como ao digitar a O.S. no lançamento), mesmo quando a operação não encaixa
        let item = enc ? { ...a, os: [enc.os], solicitante: a.solicitante || enc.resp } : a;
        if (enc?.op) {
          op = enc.op;
          item = { ...item, linhas: enc.linhas, avisos: [...a.avisos, ...enc.avisos] };
        }
        const id = await gravarItem(client, item, op, faz, BOT, ex?.id);
        if (!id) {
          // conferido ou alterado por uma pessoa depois de lido: fica como ela deixou
          res.push({ chave: a.chave, id: ex.id, acao: "conferido" });
          cont.conferidos++;
          continue;
        }
        // boletim: o próximo nº (como o sugerido no lançamento manual); editada mantém o que já tinha
        const bol = (
          await client.query("UPDATE ap_dia SET bol = COALESCE(bol, (SELECT COALESCE(MAX(bol), 0) + 1 FROM ap_dia)) WHERE id = $1 RETURNING bol", [id])
        ).rows[0].bol;
        res.push({ chave: a.chave, id, bol, acao: ex ? "atualizado" : "novo" });
        cont[ex ? "atualizados" : "novos"]++;
      }
    }
    if (cont.novos || cont.atualizados || cont.removidos)
      await auditar(client, { usuario: BOT, modulo: "Atividades", entidade: "Apontamento diário", chave: "WhatsApp (bot)", acao: "importacao", depois: cont });
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
