import { PerfilUsuario } from "./types";

/** Perfis na ordem em que aparecem nas telas (do menor para o maior acesso). */
export const PERFIS: PerfilUsuario[] = ["leitura", "analista1", "analista2", "gravacao", "admin"];

export const PERFIL_LABEL: Record<PerfilUsuario, string> = {
  leitura: "Leitura",
  analista1: "Analista I",
  analista2: "Analista II",
  gravacao: "Gravação",
  admin: "Administrador",
};

export const PERFIL_DESCRICAO: Record<PerfilUsuario, string> = {
  leitura: "Vê as telas liberadas, não pode criar, editar nem importar nada.",
  analista1: "Lança, edita e importa nas telas de operação; nos cadastros não inclui itens novos.",
  analista2: "Lança, edita e importa nas telas de operação; nos cadastros não inclui itens novos.",
  gravacao: "Cria ordens, lança apontamentos, importa planilha e inclui itens nos cadastros.",
  admin: "Tudo de Gravação, além de gerenciar usuários e os Parâmetros.",
};

/** Pode lançar e gravar: gravação, analistas e administrador — falso só para leitura. */
export function podeEditar(perfil: PerfilUsuario | undefined | null): boolean {
  return perfil === "gravacao" || perfil === "admin" || perfil === "analista1" || perfil === "analista2";
}

/** Pode incluir itens novos (e importar) nas telas de cadastro: gravação e administrador. */
export function podeIncluirCadastro(perfil: PerfilUsuario | undefined | null): boolean {
  return perfil === "gravacao" || perfil === "admin";
}

export function ehAdmin(perfil: PerfilUsuario | undefined | null): boolean {
  return perfil === "admin";
}
