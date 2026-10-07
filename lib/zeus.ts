// Cliente da API ZeusAgro (CropNet) — só roda no servidor (credenciais em ZEUS_EMAIL / ZEUS_PASSWORD).
// Pluviômetro = chuva (mm) da PIC (estação) ligada à fazenda: o "name" da fazenda na Zeus é o código da fazenda da CRV.

const BASE = process.env.ZEUS_BASE_URL || "https://www.cropnet.us/api/v1";
const TOKEN_TTL_MS = 14 * 60 * 1000; // a API expira em 15 min

interface Cache {
  token?: { valor: string; exp: number };
  login?: Promise<string>;
  mapa: Map<string, { v: unknown; exp: number }>;
}
const g = globalThis as unknown as { _zeus?: Cache };
const cache: Cache = (g._zeus ??= { mapa: new Map() });

export function zeusConfigurado(): boolean {
  return !!(process.env.ZEUS_EMAIL && process.env.ZEUS_PASSWORD);
}

async function login(): Promise<string> {
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

async function token(): Promise<string> {
  if (cache.token && cache.token.exp > Date.now()) return cache.token.valor;
  cache.login ??= login().finally(() => {
    cache.login = undefined;
  });
  return cache.login;
}

async function zeusGet<T>(path: string, tentar = true): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    headers: { Authorization: await token(), Accept: "application/json" },
    cache: "no-store",
    signal: AbortSignal.timeout(20000),
  });
  if (res.status === 401 && tentar) {
    cache.token = undefined;
    return zeusGet<T>(path, false);
  }
  if (!res.ok) throw new Error(`Zeus: HTTP ${res.status} em ${path}`);
  const dados = await res.json();
  // a API responde 200 com um texto quando a janela passa de 7 dias
  if (typeof dados === "string") throw new Error(`Zeus: ${dados}`);
  return dados as T;
}

async function comCache<T>(chave: string, ttlMs: number, buscar: () => Promise<T>): Promise<T> {
  const hit = cache.mapa.get(chave);
  if (hit && hit.exp > Date.now()) return hit.v as T;
  const v = await buscar();
  cache.mapa.set(chave, { v, exp: Date.now() + ttlMs });
  return v;
}

const HORA = 3600_000;

/** Código de fazenda da CRV sem o sufixo de sequência ("9001-1" -> "9001"). */
export function codigoBase(codigo: string): string {
  return codigo.trim().split("-")[0].trim();
}

interface PicZeus {
  picId: number;
  name: string;
  status: string;
}

/** PIC principal (primeira com status OK) da fazenda, ou null se a fazenda não existe na Zeus. */
export async function picDaFazenda(codigo: string): Promise<PicZeus | null> {
  const cod = codigoBase(codigo);
  const fazendas = await comCache("fazendas", 6 * HORA, () => zeusGet<{ areaFarmId: number; name: string }[]>("/farm"));
  const faz = fazendas.find((f) => String(f.name).trim() === cod);
  if (!faz) return null;
  const pics = await comCache(`faz:${faz.areaFarmId}`, 24 * HORA, () => zeusGet<PicZeus[]>(`/farm/${faz.areaFarmId}/pics`));
  return pics.find((p) => p.status === "OK") ?? pics[0] ?? null;
}

/** Resumo do dia de uma PIC (null = a estação não mede aquela variável, ex.: sem sensor de vento). */
export interface ClimaDia {
  chuvaMm: number;
  tMin: number | null;
  tMax: number | null;
  umidadeMed: number | null;
  ventoMedKmh: number | null;
  rajadaMaxKmh: number | null;
  radiacaoWhm2: number | null;
}

export interface ClimaPic {
  /** por dia (YYYY-MM-DD, horário local BRT) */
  dias: Record<string, ClimaDia>;
  /** "YYYY-MM-DD HH:MM" da última leitura recebida na janela */
  ultimaLeitura: string | null;
}

interface Ponto {
  started: string;
  finished?: string;
  rain: number | null;
  temperatureMin: number | null;
  temperatureMax: number | null;
  humidityInst: number | null;
  windSpeedAverage: number | null;
  gustSpeed: number | null;
  solarIrradiation: number | null;
}

const nums = (a: (number | null | undefined)[]) => a.filter((x): x is number => typeof x === "number");
const media = (a: number[]) => (a.length ? Math.round((a.reduce((s, x) => s + x, 0) / a.length) * 10) / 10 : null);
const arred = (n: number) => Math.round(n * 100) / 100;

/** Clima diário da PIC entre duas datas (máx. 7 dias). Dias passados ficam em cache por 24 h; o dia corrente por 10 min. */
export async function climaDaPic(picId: number, inicio: string, fim: string, hoje: string): Promise<ClimaPic> {
  const ttl = fim >= hoje ? 10 * 60_000 : 24 * HORA;
  return comCache(`clima:${picId}:${inicio}:${fim}`, ttl, async () => {
    const pts = await zeusGet<Ponto[]>(`/pics/${picId}/monitoring?start=${inicio}&end=${fim}&timeZone=-3`);
    // com timeZone=-3 o horário já vem local, só rotulado "+0000": usar o texto cru, sem converter
    const porDia: Record<string, Ponto[]> = {};
    let ultima: string | null = null;
    for (const p of pts) {
      (porDia[p.started.slice(0, 10)] ??= []).push(p);
      const fimLeitura = (p.finished ?? p.started).slice(0, 16).replace("T", " ");
      if (!ultima || fimLeitura > ultima) ultima = fimLeitura;
    }
    const dias: Record<string, ClimaDia> = {};
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
