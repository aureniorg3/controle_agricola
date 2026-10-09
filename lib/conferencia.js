export const STATUS_CONFERENCIA_LABEL = {
  ok: "OK",
  "frente-divergente": "Frente divergente",
  "ordem-outra-frente": "Ordem de outra frente",
  "sem-ordem": "Sem ordem",
  "sem-cadastro": "Sem cadastro",
};

export function normalizarFrente(f) {
  return f.replace(/\s+/g, " ").trim().toUpperCase();
}

/** Frente cadastrada para o equipamento numa data: o último lançamento com
 * vigência <= data (antes do primeiro lançamento, não há frente). */
export function frenteDoEquipamento(equiptos, eqp, data) {
  let atual;
  for (const e of equiptos) {
    if (e.eqp === eqp && e.vigencia <= data && (!atual || e.vigencia > atual.vigencia)) atual = e;
  }
  return atual ? atual.frente : null;
}

function numeroOrdem(n) {
  const v = parseInt(n, 10);
  return Number.isFinite(v) ? v : 0;
}

/** Entre as ordens da fazenda: aberta antes de encerrada, depois a de entrada
 * mais recente (e, no empate, o maior número de ordem). */
function melhorOrdem(candidatas) {
  if (candidatas.length === 0) return null;
  return [...candidatas].sort((a, b) => {
    if (a.status !== b.status) return a.status === "Aberta" ? -1 : 1;
    const ua = a.ultimaEntrada ?? "";
    const ub = b.ultimaEntrada ?? "";
    if (ua !== ub) return ua < ub ? 1 : -1;
    return numeroOrdem(b.numero) - numeroOrdem(a.numero);
  })[0];
}

/**
 * Cruza cada linha do relatório (equipamento x frente x fazenda x dia) com:
 *  - a frente em que o equipamento está cadastrado naquela data;
 *  - a ordem de corte da fazenda — preferindo ordens da mesma frente do
 *    cadastro; entre elas, a aberta mais recente, ou, não havendo aberta, a
 *    encerrada mais recente.
 */
export function conferirLinhas(linhas, equiptos, ordens) {
  const porFazenda = new Map();
  for (const o of ordens) {
    for (const f of o.fazendas) {
      const lista = porFazenda.get(f.codigo) ?? [];
      lista.push(o);
      porFazenda.set(f.codigo, lista);
    }
  }

  return linhas.map((l) => {
    const frenteCadastro = frenteDoEquipamento(equiptos, l.eqp, l.data);
    const daFazenda = porFazenda.get(l.fazendaCodigo) ?? [];
    const referencia = frenteCadastro ?? l.frente;
    const daMesmaFrente = daFazenda.filter((o) => normalizarFrente(o.frente) === normalizarFrente(referencia));
    const ordem = melhorOrdem(daMesmaFrente.length > 0 ? daMesmaFrente : daFazenda);

    let conferencia;
    if (frenteCadastro === null) conferencia = "sem-cadastro";
    else if (normalizarFrente(l.frente) !== normalizarFrente(frenteCadastro)) conferencia = "frente-divergente";
    else if (!ordem) conferencia = "sem-ordem";
    else if (normalizarFrente(ordem.frente) !== normalizarFrente(frenteCadastro)) conferencia = "ordem-outra-frente";
    else conferencia = "ok";

    const nomeNaOrdem = ordem?.fazendas.find((f) => f.codigo === l.fazendaCodigo)?.nome;
    return {
      ...l,
      frenteCadastro,
      ordemNumero: ordem?.numero ?? null,
      ordemFrente: ordem?.frente ?? null,
      ordemStatus: ordem?.status ?? null,
      fazendaNomeExibido: nomeNaOrdem || l.fazendaNome,
      conferencia,
    };
  });
}
