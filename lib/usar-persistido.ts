"use client";

import { useEffect, useState, type Dispatch, type SetStateAction } from "react";

/**
 * Igual ao useState, mas lembra o valor neste navegador (localStorage): ao
 * atualizar a página ou voltar à tela, o filtro/data escolhido continua o
 * mesmo. Começa com o valor inicial (para o servidor e o navegador
 * renderizarem igual) e troca pelo guardado assim que a tela abre.
 * `validar` descarta valores guardados que não servem mais (ex.: formato errado).
 */
export function usarPersistido<T>(
  chave: string,
  inicial: T | (() => T),
  validar?: (v: unknown) => v is T
): [T, Dispatch<SetStateAction<T>>] {
  const [valor, setValor] = useState<T>(inicial);
  // só passa a gravar depois que o valor guardado foi lido e aplicado (senão o inicial o sobrescreveria)
  const [pronto, setPronto] = useState(false);
  const nomeChave = `ca_ui:${chave}`;

  useEffect(() => {
    try {
      const bruto = localStorage.getItem(nomeChave);
      if (bruto !== null) {
        const lido = JSON.parse(bruto) as unknown;
        if (!validar || validar(lido)) setValor(lido as T);
      }
    } catch {
      /* navegador sem armazenamento: segue com o valor inicial */
    }
    setPronto(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nomeChave]);

  useEffect(() => {
    if (!pronto) return;
    try {
      localStorage.setItem(nomeChave, JSON.stringify(valor));
    } catch {
      /* cheio ou bloqueado: o filtro só não será lembrado */
    }
  }, [valor, nomeChave, pronto]);

  return [valor, setValor];
}

export const ehTexto = (v: unknown): v is string => typeof v === "string";
export const ehBooleano = (v: unknown): v is boolean => typeof v === "boolean";
export const ehDataIso = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);
export const ehUmDe =
  <T extends string | number>(opcoes: readonly T[]) =>
  (v: unknown): v is T =>
    opcoes.includes(v as T);
