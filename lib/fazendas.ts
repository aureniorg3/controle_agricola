/** Regras (sem banco) da descrição das fazendas. */

/**
 * Tira os números, espaços e traços que vêm antes do nome da fazenda:
 * "9386 - FAZ. NOSSA SENHORA DE LOURDES" → "FAZ. NOSSA SENHORA DE LOURDES"; "- FAZ. X" → "FAZ. X";
 * "9386 FAZ. X" → "FAZ. X". Número curto sem traço que faz parte do nome ("3 IRMAOS") fica.
 */
export function limparNomeFazenda(nome: string, codigo = ""): string {
  const s = nome.replace(/\s+/g, " ").trim();
  let r = s.replace(/^(?:\d+\s*[-–—]+\s*|[-–—]+\s*|\d{3,}\s+)+/, "");
  // o próprio código da fazenda colado no começo, sem traço: "9386FAZ. X" não acontece, mas "9386 X" sim (já coberto acima)
  const cod = codigo.trim();
  if (cod && r === s && s.startsWith(`${cod} `)) r = s.slice(cod.length).trim();
  return r || s;
}
