import { PerfilUsuario } from "./types";

export const PERFIL_LABEL: Record<PerfilUsuario, string> = {
  leitura: "Leitura",
  gravacao: "Gravação",
  admin: "Administrador",
};

export const PERFIL_DESCRICAO: Record<PerfilUsuario, string> = {
  leitura: "Vê todas as telas, não pode criar, editar nem importar nada.",
  gravacao: "Cria ordens, lança apontamentos, importa planilha.",
  admin: "Tudo de Gravação, além de gerenciar usuários.",
};

/** true para gravacao e admin — falso só para leitura. */
export function podeEditar(perfil: PerfilUsuario | undefined | null): boolean {
  return perfil === "gravacao" || perfil === "admin";
}

export function ehAdmin(perfil: PerfilUsuario | undefined | null): boolean {
  return perfil === "admin";
}
