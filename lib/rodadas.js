/** Tipos e regras de calendário das Rodadas de Campo (sem acesso a banco — vale no navegador e no servidor). */

export const SEMANAS_POR_RODADA = 8;

function utc(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function iso(d) {
  return d.toISOString().slice(0, 10);
}

export function somarDias(isoData, dias) {
  const d = utc(isoData);
  d.setUTCDate(d.getUTCDate() + dias);
  return iso(d);
}

/** Segunda-feira da semana da data (a própria data, se já for segunda). */
export function segundaDaSemana(isoData) {
  const d = utc(isoData);
  const dow = d.getUTCDay(); // 0 = domingo
  d.setUTCDate(d.getUTCDate() - (dow === 0 ? 6 : dow - 1));
  return iso(d);
}

/** As 8 semanas da rodada, cada uma de segunda a domingo, a partir da semana da data informada. */
export function gerarSemanas(inicio) {
  const primeira = segundaDaSemana(inicio);
  return Array.from({ length: SEMANAS_POR_RODADA }, (_, i) => {
    const ini = somarDias(primeira, i * 7);
    return { sem: i + 1, ini, fim: somarDias(ini, 6) };
  });
}

/** Semana da rodada em que a data cai (ou null se estiver fora do calendário). */
export function semanaDaData(semanas, data) {
  return semanas.find((s) => data >= s.ini && data <= s.fim)?.sem ?? null;
}
