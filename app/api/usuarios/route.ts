import { NextRequest, NextResponse } from "next/server";
import { insertUsuario, listUsuarios, usuarioDaRequisicao } from "@/lib/db";
import { ehAdmin } from "@/lib/permissoes";
import { PerfilUsuario, Usuario } from "@/lib/types";

const PERFIS_VALIDOS: PerfilUsuario[] = ["leitura", "gravacao", "admin"];
// letras minúsculas, números, ponto, underscore e hífen — sem espaços/acentos
const USUARIO_REGEX = /^[a-z0-9._-]{3,30}$/;

function semSenha(u: Usuario) {
  const { senhaHash: _senhaHash, ...resto } = u;
  return resto;
}

export async function GET(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !ehAdmin(usuario.perfil)) {
    return NextResponse.json({ error: "Só administradores podem ver usuários." }, { status: 403 });
  }
  const usuarios = await listUsuarios();
  return NextResponse.json({ usuarios: usuarios.map(semSenha) });
}

interface NovoUsuarioBody {
  nome: string;
  sobrenome: string;
  email: string;
  usuario: string;
  perfil: PerfilUsuario;
}

export async function POST(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !ehAdmin(usuario.perfil)) {
    return NextResponse.json({ error: "Só administradores podem criar usuários." }, { status: 403 });
  }

  const body = (await req.json()) as NovoUsuarioBody;
  if (!body.nome?.trim() || !body.sobrenome?.trim() || !body.email?.trim() || !body.usuario?.trim()) {
    return NextResponse.json({ error: "Informe nome, sobrenome, e-mail e nome de usuário." }, { status: 400 });
  }
  if (!USUARIO_REGEX.test(body.usuario.trim().toLowerCase())) {
    return NextResponse.json(
      { error: "Nome de usuário deve ter 3-30 caracteres: letras, números, ponto, hífen ou underscore." },
      { status: 400 }
    );
  }
  if (!PERFIS_VALIDOS.includes(body.perfil)) {
    return NextResponse.json({ error: "Nível de acesso inválido." }, { status: 400 });
  }

  const resultado = await insertUsuario({
    nome: body.nome,
    sobrenome: body.sobrenome,
    email: body.email,
    usuario: body.usuario,
    perfil: body.perfil,
  });
  if ("erro" in resultado) {
    return NextResponse.json({ error: resultado.erro }, { status: 409 });
  }

  const { usuario: criado, senhaProvisoria } = resultado;
  return NextResponse.json({ usuario: semSenha(criado), senhaProvisoria }, { status: 201 });
}
