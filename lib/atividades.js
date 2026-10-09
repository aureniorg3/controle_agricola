/** Tipos e regras (sem banco) de Atividades › Apontamentos Diários. */

/** Uma linha da base de O.S. (Acompanhamento de O.S.): O.S. × talhão × operação. */

/** Como a área do dia foi informada: talhão a talhão, ou um volume total rateado entre os talhões marcados. */

/** Insumo aplicado no apontamento (código do cadastro Material e Insumos). */

export const chaveTalhao = (propCod, tlh) => `${propCod}|${tlh}`;
export const round2 = (n) => Math.round(n * 100) / 100;

const DATA = /^\d{4}-\d{2}-\d{2}$/;

// ---------------------------------------------------------------------------
// Campos obrigatórios (Parâmetros › Apontamento Diário)
// ---------------------------------------------------------------------------

/** Campos que podem ser marcados como obrigatórios, na ordem da tela. */
export const CAMPOS_APONTAMENTO = [
  { campo: "os", rotulo: "Ordem de Serviço", ajuda: "Sem a O.S. marcada, o apontamento pode ser lançado só com fazenda e talhões." },
  { campo: "operacao", rotulo: "Operação", ajuda: "Com O.S. a operação é sempre obrigatória (vem da O.S.)." },
  { campo: "solicitante", rotulo: "Solicitante" },
  { campo: "etapa", rotulo: "Etapa" },
  { campo: "tipoAplicacao", rotulo: "Tipo de aplicação" },
  { campo: "talhao", rotulo: "Talhão", ajuda: "Desmarcado, dá para lançar a área só com a fazenda." },
  { campo: "eqp", rotulo: "Equipamento" },
  { campo: "numEquipamentos", rotulo: "Nº de equipamentos" },
  { campo: "numPessoas", rotulo: "Nº de pessoas" },
  { campo: "vazaoRec", rotulo: "Vazão recomendada" },
  { campo: "volCalda", rotulo: "Volume de calda" },
  { campo: "vazaoUti", rotulo: "Vazão utilizada", ajuda: "Conta como preenchida quando é calculada pela calda ÷ área." },
  { campo: "obs", rotulo: "Observação" },
];

/** Como era antes do parâmetro existir: operação, solicitante e talhão obrigatórios. */
export const REGRAS_PADRAO = {
  os: false,
  operacao: true,
  solicitante: true,
  etapa: false,
  tipoAplicacao: false,
  talhao: true,
  eqp: false,
  numEquipamentos: false,
  numPessoas: false,
  vazaoRec: false,
  volCalda: false,
  vazaoUti: false,
  obs: false,
};

export function normalizarRegras(v) {
  const r = { ...REGRAS_PADRAO };
  if (v && typeof v === "object") for (const c of CAMPOS_APONTAMENTO) if (typeof v[c.campo] === "boolean") r[c.campo] = v[c.campo];
  return r;
}

/** Rótulos dos campos obrigatórios que ficaram em branco (o talhão é conferido à parte, linha a linha). */
export function camposFaltando(e, regras, vazaoCalculada = false) {
  const vazio = {
    operacao: !e.opCod.trim(),
    solicitante: !e.solicitante.trim(),
    etapa: !e.etapaCod.trim(),
    tipoAplicacao: !e.tipoAplicacao.trim(),
    eqp: !e.eqp.trim(),
    numEquipamentos: !(e.numEquipamentos > 0),
    numPessoas: !(e.numPessoas > 0),
    vazaoRec: !(e.vazaoRec !== null && e.vazaoRec > 0),
    volCalda: !(e.volCalda !== null && e.volCalda > 0),
    vazaoUti: !(e.vazaoUti !== null && e.vazaoUti > 0) && !vazaoCalculada,
    obs: !e.obs.trim(),
  };
  return CAMPOS_APONTAMENTO.filter((c) => c.campo !== "os" && c.campo !== "talhao" && regras[c.campo] && vazio[c.campo]).map((c) => c.rotulo);
}

/** Confere o formulário (sem consultar a base) e devolve o erro, ou null. */
export function validarApontamento(e, regras = REGRAS_PADRAO) {
  if (!Number.isInteger(e.boletim) || e.boletim <= 0) return "Informe o número do boletim.";
  if (!DATA.test(e.dt) || Number.isNaN(Date.parse(e.dt))) return "Informe a data do apontamento.";
  if (regras.os && e.semOS) return "Informe a Ordem de Serviço.";
  if (e.semOS && e.talhoes.some((t) => !t.propCod.trim())) return "Informe a fazenda em todas as linhas.";
  // com O.S. a operação sempre vem dela; sem O.S., só se o parâmetro pedir
  if (!e.semOS && !e.opCod.trim()) return "Escolha a operação.";
  // vazão utilizada em branco é calculada (calda ÷ área); com O.S., a etapa pode vir da operação (conferida ao gravar)
  const areaInformada = e.modoArea === "rateio" ? (e.volume ?? 0) : e.talhoes.reduce((a, t) => a + (t.area > 0 ? t.area : 0), 0);
  const vazaoCalculada = e.vazaoUti === null && (e.volCalda ?? 0) > 0 && areaInformada > 0;
  const falta = camposFaltando(e, { ...regras, etapa: regras.etapa && e.semOS }, vazaoCalculada);
  if (falta.length) return `Preencha: ${falta.join(", ")}.`;
  if (!Number.isInteger(e.numEquipamentos) || e.numEquipamentos < 0) return "Número de equipamentos inválido.";
  if (!Number.isInteger(e.numPessoas) || e.numPessoas < 0) return "Número de pessoas inválido.";
  for (const [v, nome] of [
    [e.vazaoRec, "Vazão recomendada"],
    [e.vazaoUti, "Vazão utilizada"],
    [e.volCalda, "Volume de calda"],
  ]) {
    if (v !== null && (!Number.isFinite(v) || v < 0)) return `${nome} inválido(a).`;
  }
  for (const i of e.insumos) {
    if (!i.cod.trim()) return "Há insumo sem código.";
    if ((i.dose !== null && (!Number.isFinite(i.dose) || i.dose < 0)) || (i.qtd !== null && (!Number.isFinite(i.qtd) || i.qtd < 0))) {
      return `Insumo ${i.cod}: dose ou total inválido.`;
    }
  }
  if (regras.talhao && e.talhoes.some((t) => !t.tlh.trim())) return "Informe o talhão em todas as linhas.";
  if (e.modoArea === "rateio") {
    if (!(e.volume !== null && Number.isFinite(e.volume) && e.volume > 0)) return "Informe o volume (ha) a ratear.";
    if (e.talhoes.length === 0) return "Marque os talhões que vão receber o rateio.";
    return null;
  }
  const comArea = e.talhoes.filter((t) => t.area > 0);
  if (e.talhoes.some((t) => !Number.isFinite(t.area) || t.area < 0)) return "Há área realizada inválida em algum talhão.";
  if (comArea.length === 0) return "Informe a área realizada em pelo menos um talhão.";
  return null;
}

/**
 * Rateia o volume entre os talhões, proporcional à área de cada um (quando todos têm área); sem área, divide igual.
 * Arredonda em centésimos e acerta a diferença no maior talhão, para a soma bater com o volume.
 */
export function ratearArea(volume, areas) {
  if (areas.length === 0 || !(volume > 0)) return areas.map(() => 0);
  const pesos = areas.every((a) => a !== null && a > 0) ? areas : areas.map(() => 1);
  const soma = pesos.reduce((a, b) => a + b, 0);
  const r = pesos.map((p) => round2((volume * p) / soma));
  const dif = round2(volume - r.reduce((a, b) => a + b, 0));
  if (dif !== 0) {
    const i = pesos.indexOf(Math.max(...pesos));
    r[i] = round2(r[i] + dif);
  }
  return r;
}
