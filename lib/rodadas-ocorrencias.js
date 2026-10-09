/**
 * Interpreta o texto livre de ocorrência que veio da planilha de levantamento
 * ("COLONIÃO E MAMONA", "BRACHIARIA, COLONIÃO, FORMIGA"...) e o converte para
 * os itens do Cadastro de Ocorrências. O que não for reconhecido vira "Outros".
 * Código sem acesso a banco: dá para testar e usar no navegador e no servidor.
 */

export function normalizar(t) {
  return t.normalize("NFD").replace(/[̀-ͯ]/g, "").toUpperCase();
}

function palavras(t) {
  return normalizar(t)
    .split(/[^A-Z0-9]+/)
    .filter(Boolean);
}

function distancia(a, b) {
  if (a === b) return 0;
  const m = a.length;
  const n = b.length;
  if (Math.abs(m - n) > 2) return 3;
  let anterior = Array.from({ length: n + 1 }, (_, j) => j);
  for (let i = 1; i <= m; i++) {
    const atual = [i];
    for (let j = 1; j <= n; j++) {
      atual[j] = Math.min(anterior[j] + 1, atual[j - 1] + 1, anterior[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    anterior = atual;
  }
  return anterior[n];
}

/** palavra do texto (b) confere com a do apelido (a): igual, plural ou com um/dois erros de digitação */
function confere(a, b) {
  if (a === b) return true;
  if (a.length >= 4 && (a + "S" === b || a === b + "S")) return true;
  if (a.length >= 6 && distancia(a, b) <= (a.length >= 9 ? 2 : 1)) return true;
  return false;
}

/** apelidos extras, por nome (normalizado) do item do cadastro; os nomes com "/" já viram um apelido para cada parte */
const APELIDOS = {
  BRACHIARIA: ["BRAQUIARIA", "BRACIARIA", "BRAQUIARIA", "BRAQUIARA"],
  "BROTO DO CERRADO": ["BROTO CERRADO", "BROTO DE CERRADO"],
  "CAPIM CAMALOTE": ["CAMALOTE"],
  "CAPIM COLCHAO": ["COLCHAO"],
  "CORDA DE VIOLA": ["CORDA VIOLA", "CORDA DE VIOLAS"],
  "GRAMA DE BURRO": ["GRAMA BURRO"],
  MASSAMBARA: ["MASSAMBARAS", "MASAMBARA"],
  TIRIRICA: ["TIRIRIÇA"],
  "ANOMALIA VIZINHA": ["ANOMALIA"],
  "BORDA SUJA": ["BORDADURA SUJA"],
  "ESTRIA VERMELHA": ["ESTRIA"],
  "GADO/CAPIVARA": ["BOI", "BOIS"],
  PRAGAS: ["PRAGA"],
};

const PARADAS = new Set([
  "E",
  "A",
  "O",
  "AS",
  "OS",
  "DE",
  "DO",
  "DA",
  "DOS",
  "DAS",
  "COM",
  "EM",
  "NO",
  "NA",
  "NOS",
  "NAS",
  "TEM",
  "TODOS",
  "TODAS",
  "TALHAO",
  "TALHOES",
  "T",
  "AO",
  "ATE",
  "SEM",
  "OBSERVACAO",
  "OBSERVACOES",
  "OBS",
  "NENHUMA",
  "NENHUM",
  "NAO",
  "HA",
  "POR",
  "PARA",
  "UM",
  "UMA",
  "PELA",
  "PELO",
  "MUITA",
  "MUITO",
]);
const NEGACAO = new Set(["SEM", "NAO", "NENHUMA", "NENHUM"]);

export function montarIndice(cadastro) {
  const lista = [];
  for (const item of cadastro) {
    const base = normalizar(item.nm).trim();
    const nomes = new Set([base, ...base.split("/").map((p) => p.trim()), ...(APELIDOS[base] ?? []).map(normalizar)]);
    // "Árvore Seca/Caída": cada parte pode vir com a primeira palavra do outro lado ("ARVORE SECA", "ARVORE CAIDA")
    const partes = base.split("/").map((p) => p.trim());
    if (partes.length === 2) {
      const primeira = partes[0].split(/\s+/);
      if (primeira.length > 1) nomes.add(`${primeira.slice(0, -1).join(" ")} ${partes[1]}`);
    }
    for (const n of nomes) {
      const p = palavras(n);
      if (p.length > 0) lista.push({ cod: item.cod, palavras: p });
    }
  }
  // apelidos longos primeiro, para "CAPIM COLCHAO" ganhar de qualquer parte menor
  return lista.sort((a, b) => b.palavras.length - a.palavras.length);
}

export function interpretar(texto, indice) {
  const originais = texto.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const normais = originais.map((o) => normalizar(o));
  const usadas = new Array(normais.length).fill(false);
  const achados = [];

  for (const ap of indice) {
    const tam = ap.palavras.length;
    for (let i = 0; i + tam <= normais.length; i++) {
      if (usadas.slice(i, i + tam).some(Boolean)) continue;
      if (!ap.palavras.every((p, k) => confere(p, normais[i + k]))) continue;
      for (let k = 0; k < tam; k++) usadas[i + k] = true;
      // "SEM CIGARRINHA": a ocorrência é negada, então não conta
      const antes = [normais[i - 1], normais[i - 2]].filter(Boolean);
      if (!antes.some((a) => NEGACAO.has(a))) achados.push({ pos: i, cod: ap.cod });
    }
  }

  achados.sort((a, b) => a.pos - b.pos);
  const cods = [...new Set(achados.map((a) => a.cod))];
  const sobra = originais.filter((_, i) => !usadas[i] && !PARADAS.has(normais[i]) && !/^\d+$/.test(normais[i]));
  const outros = sobra.join(" ").trim();
  return { cods, outros, nenhuma: cods.length === 0 && outros === "" };
}
