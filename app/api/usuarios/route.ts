import { NextRequest, NextResponse } from "next/server";
import { insertUsuario, listUsuarios, usuarioDaRequisicao } from "@/lib/db";
import { ehAdmin } from "@/lib/permissoes";
import { PerfilUsuario, Usuario } from "@/lib/types";

const PERFIS_VALIDOS: PerfilUsuario[] = ["leitura", "gravacao", "admin"];

function semSenha(u: Usuario) {
  const { senhaHash: _senhaHash, ...resto } = u;
  return resto;
}

export async function GET(req: NextRequest) {
  const usuario = usuarioDaRequisicao(req);
  if (!usuario || !ehAdmin(usuario.perfil)) {
    return NextResponse.json({ error: "Só administradores podem ver usuários." }, { status: 403 });
  }
  return NextResponse.json({ usuarios: listUsuarios().map(semSenha) });
}

interface NovoUsuarioBody {
  nome: string;
  email: string;
  senha: string;
  perfil: PerfilUsuario;
}

export async function POST(req: NextRequest) {
  const usuario = usuarioDaRequisicao(req);
  if (!usuario || !ehAdmin(usuario.perfil)) {
    return NextResponse.json({ error: "Só administradores podem criar usuários." }, { status: 403 });
  }

  const body = (await req.json()) as NovoUsuarioBody;
  if (!body.nome?.trim() || !body.email?.trim()) {
    return NextResponse.json({ error: "Informe nome e e-mail." }, { status: 400 });
  }
  if (!body.senha || body.senha.length < 6) {
    return NextResponse.json({ error: "A senha precisa ter ao menos 6 caracteres." }, { status: 400 });
  }
  if (!PERFIS_VALIDOS.includes(body.perfil)) {
    return NextResponse.json({ error: "Nível de acesso inválido." }, { status: 400 });
  }

  const resultado = insertUsuario({
    nome: body.nome,
    email: body.email,
    senha: body.senha,
    perfil: body.perfil,
  });
  if ("erro" in resultado) {
    return NextResponse.json({ error: resultado.erro }, { status: 409 });
  }
  return NextResponse.json({ usuario: semSenha(resultado) }, { status: 201 });
}
