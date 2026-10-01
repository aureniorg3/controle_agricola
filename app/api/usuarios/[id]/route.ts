import { NextRequest, NextResponse } from "next/server";
import { deleteUsuario, updateUsuario, usuarioDaRequisicao } from "@/lib/db";
import { ehAdmin } from "@/lib/permissoes";
import { PerfilUsuario, Usuario } from "@/lib/types";

const PERFIS_VALIDOS: PerfilUsuario[] = ["leitura", "gravacao", "admin"];
// letras minúsculas, números, ponto, underscore e hífen — sem espaços/acentos
const USUARIO_REGEX = /^[a-z0-9._-]{3,30}$/;

function semSenha(u: Usuario) {
  const { senhaHash: _senhaHash, ...resto } = u;
  return resto;
}

interface PatchBody {
  nome?: string;
  sobrenome?: string;
  usuario?: string;
  perfil?: PerfilUsuario;
  ativo?: boolean;
  senha?: string;
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const solicitante = await usuarioDaRequisicao(req);
  if (!solicitante || !ehAdmin(solicitante.perfil)) {
    return NextResponse.json({ error: "Só administradores podem editar usuários." }, { status: 403 });
  }

  const { id } = await params;
  const body = (await req.json()) as PatchBody;

  if (body.perfil !== undefined && !PERFIS_VALIDOS.includes(body.perfil)) {
    return NextResponse.json({ error: "Nível de acesso inválido." }, { status: 400 });
  }
  if (body.usuario !== undefined && !USUARIO_REGEX.test(body.usuario.trim().toLowerCase())) {
    return NextResponse.json(
      { error: "Nome de usuário deve ter 3-30 caracteres: letras, números, ponto, hífen ou underscore." },
      { status: 400 }
    );
  }
  if (body.senha !== undefined && body.senha.length > 0 && body.senha.length < 6) {
    return NextResponse.json({ error: "A senha precisa ter ao menos 6 caracteres." }, { status: 400 });
  }

  const resultado = await updateUsuario(
    id,
    {
      nome: body.nome,
      sobrenome: body.sobrenome,
      usuario: body.usuario,
      perfil: body.perfil,
      ativo: body.ativo,
      senha: body.senha || undefined,
    },
    solicitante.id
  );
  if ("erro" in resultado) {
    return NextResponse.json({ error: resultado.erro }, { status: 409 });
  }
  return NextResponse.json({ usuario: semSenha(resultado) });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const solicitante = await usuarioDaRequisicao(req);
  if (!solicitante || !ehAdmin(solicitante.perfil)) {
    return NextResponse.json({ error: "Só administradores podem excluir usuários." }, { status: 403 });
  }

  const { id } = await params;
  const resultado = await deleteUsuario(id, solicitante.id);
  if (resultado !== true) {
    return NextResponse.json({ error: resultado.erro }, { status: 409 });
  }
  return NextResponse.json({ ok: true });
}
