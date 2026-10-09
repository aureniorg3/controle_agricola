import { addDays, startOfWeekMonday } from "./period";
import { codigoFazendaBase } from "./clima";

// Cliente da API ZeusAgro (CropNet) — só roda no servidor (credenciais em ZEUS_EMAIL / ZEUS_PASSWORD).
// Pluviômetro = chuva (mm) da PIC (estação) ligada à fazenda: o "name" da fazenda na Zeus é o código da fazenda da CRV.

const BASE = process.env.ZEUS_BASE_URL || "https://www.cropnet.us/api/v1";
const TOKEN_TTL_MS = 14 * 60 * 1000; // a API expira em 15 min

const g = globalThis;
const cache = (g._zeus ??= { mapa: new Map() });

export function zeusConfigurado() {
  return !!(process.env.ZEUS_EMAIL && process.env.ZEUS_PASSWORD);
}

async function login() {
  const res = await fetch(`${BASE}/login`, {
    method: "POST",
    // sem Accept: application/json o servidor devolve um 404 de JSP
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ email: process.env.ZEUS_EMAIL, password: process.env.ZEUS_PASSWORD }),
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Zeus: login falhou (HTTP ${res.status})`);
  const token = (await res.json())?.user?.token;
  if (!token) throw new Error("Zeus: login sem token");
  cache.token = { valor: token, exp: Date.now() + TOKEN_TTL_MS };
  return token;
}

async function token() {
  if (cache.token && cache.token.exp > Date.now()) return cache.token.valor;
  cache.login ??= login().finally(() => {
    cache.login = undefined;
  });
  return cache.login;
}

async function zeusGet(path, tentar = true) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: await token(), Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 401 && tentar) {
    cache.token = undefined;
    return zeusGet(path, false);
  }
  if (!res.ok) throw new Error(`Zeus: HTTP ${res.status} em ${path}`);
  const dados = await res.json();
  // a API responde 200 com um texto quando a janela passa de 7 dias
  if (typeof dados === "string") throw new Error(`Zeus: ${dados}`);
  return dados;
}

async function comCache(chave, ttlMs, buscar) {
  const hit = cache.mapa.get(chave);
  if (hit && hit.exp > Date.now()) return hit.v;
  const v = await buscar();
  cache.mapa.set(chave, { v, exp: Date.now() + ttlMs });
  return v;
}

const HORA = 3600_000;

/** PIC principal (primeira com status OK) da fazenda, ou null se a fazenda não existe na Zeus. */
export async function picDaFazenda(codigo) {
  const cod = codigoFazendaBase(codigo);
  const fazendas = await comCache("fazendas", 6 * HORA, () => zeusGet("/farm"));
  const faz = fazendas.find((f) => String(f.name).trim() === cod);
  if (!faz) return null;
  const pics = await comCache(`faz:${faz.areaFarmId}`, 24 * HORA, () => zeusGet(`/farm/${faz.areaFarmId}/pics`));
  return pics.find((p) => p.status === "OK") ?? pics[0] ?? null;
}

/** Resumo do dia de uma PIC (null = a estação não mede aquela variável, ex.: sem sensor de vento). */
const nums = (a) => a.filter((x) => typeof x === "number");
const media = (a) => (a.length ? Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 10) / 10 : null);
const arred = (n) => Math.round(n * 100) / 100;

/**
 * Clima diário de uma PIC num intervalo qualquer. A Zeus limita a janela a 7 dias,
 * então busca semana a semana (segunda a domingo): cada semana fica em cache e é
 * reaproveitada por qualquer data/período que a inclua.
 */
export async function climaDaPicPeriodo(picId, inicio, fim, hoje) {
  const semanas = [];
  for (let s = startOfWeekMonday(inicio); s <= fim && s <= hoje; s = addDays(s, 7)) {
    const e = addDays(s, 6);
    semanas.push([s, e > hoje ? hoje : e]);
  }
  const partes = await Promise.all(semanas.map(([s, e]) => climaDaPic(picId, s, e, hoje)));
  const dias = {};
  let ultima = null;
  for (const p of partes) {
    Object.assign(dias, p.dias);
    if (p.ultimaLeitura && (!ultima || p.ultimaLeitura > ultima)) ultima = p.ultimaLeitura;
  }
  return { dias, ultimaLeitura: ultima };
}

/** Resume os dias de inicio..fim (só os que têm leitura); null se não houver nenhum. */
export function agregarClima(dias, inicio, fim) {
  const lista = [];
  for (let d = inicio; d <= fim; d = addDays(d, 1)) if (dias[d]) lista.push(dias[d]);
  if (!lista.length) return null;
  const ext = (a, f) => {
    const v = nums(a);
    return v.length ? f(...v) : null;
  };
  const rad = nums(lista.map((d) => d.radiacaoWhm2));
  return {
    chuvaMm: arred(lista.reduce((s, d) => s + d.chuvaMm, 0)),
    diasComChuva: lista.filter((d) => d.chuvaMm >= 1).length,
    nDias: lista.length,
    tMin: ext(
      lista.map((d) => d.tMin),
      Math.min,
    ),
    tMax: ext(
      lista.map((d) => d.tMax),
      Math.max,
    ),
    umidadeMed: media(nums(lista.map((d) => d.umidadeMed))),
    ventoMedKmh: media(nums(lista.map((d) => d.ventoMedKmh))),
    rajadaMaxKmh: ext(
      lista.map((d) => d.rajadaMaxKmh),
      Math.max,
    ),
    radiacaoWhm2: rad.length ? Math.round(rad.reduce((s, x) => s + x, 0) / rad.length) : null,
  };
}

/** Clima diário da PIC entre duas datas (máx. 7 dias). Dias passados ficam em cache por 24 h; o dia corrente por 10 min. */
export async function climaDaPic(picId, inicio, fim, hoje) {
  const ttl = fim >= hoje ? 10 * 60_000 : 24 * HORA;
  return comCache(`clima:${picId}:${inicio}:${fim}`, ttl, async () => {
    const pts = await zeusGet(`/pics/${picId}/monitoring?start=${inicio}&end=${fim}&timeZone=-3`);
    // com timeZone=-3 o horário já vem local, só rotulado "+0000": usar o texto cru, sem converter
    const porDia = {};
    let ultima = null;
    for (const p of pts) {
      (porDia[p.started.slice(0, 10)] ??= []).push(p);
      const fimLeitura = (p.finished ?? p.started).slice(0, 16).replace("T", " ");
      if (!ultima || fimLeitura > ultima) ultima = fimLeitura;
    }
    const dias = {};
    for (const [dia, ps] of Object.entries(porDia)) {
      const tmin = nums(ps.map((p) => p.temperatureMin));
      const tmax = nums(ps.map((p) => p.temperatureMax));
      const raj = nums(ps.map((p) => p.gustSpeed));
      const rad = nums(ps.map((p) => p.solarIrradiation));
      dias[dia] = {
        chuvaMm: arred(nums(ps.map((p) => p.rain)).reduce((s, x) => s + x, 0)),
        tMin: tmin.length ? Math.min(...tmin) : null,
        tMax: tmax.length ? Math.max(...tmax) : null,
        umidadeMed: media(nums(ps.map((p) => p.humidityInst))),
        ventoMedKmh: media(nums(ps.map((p) => p.windSpeedAverage))),
        rajadaMaxKmh: raj.length ? Math.max(...raj) : null,
        radiacaoWhm2: rad.length ? Math.round(rad.reduce((s, x) => s + x, 0)) : null,
      };
    }
    return { dias, ultimaLeitura: ultima };
  });
}
