import { NextRequest, NextResponse } from "next/server";
import { insertUsuario, listUsuarios, usuarioDaRequisicao } from "@/lib/db";
import { enviarEmailBoasVindas } from "@/lib/email";
import { ehAdmin } from "@/lib/permissoes";
import { PerfilUsuario, Usuario } from "@/lib/types";

const PERFIS_VALIDOS: PerfilUsuario[] = ["leitura", "gravacao", "admin"];

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
  perfil: PerfilUsuario;
}

export async function POST(req: NextRequest) {
  const usuario = await usuarioDaRequisicao(req);
  if (!usuario || !ehAdmin(usuario.perfil)) {
    return NextResponse.json({ error: "Só administradores podem criar usuários." }, { status: 403 });
  }

  const body = (await req.json()) as NovoUsuarioBody;
  if (!body.nome?.trim() || !body.sobrenome?.trim() || !body.email?.trim()) {
    return NextResponse.json({ error: "Informe nome, sobrenome e e-mail." }, { status: 400 });
  }
  if (!PERFIS_VALIDOS.includes(body.perfil)) {
    return NextResponse.json({ error: "Nível de acesso inválido." }, { status: 400 });
  }

  const resultado = await insertUsuario({
    nome: body.nome,
    sobrenome: body.sobrenome,
    email: body.email,
    perfil: body.perfil,
  });
  if ("erro" in resultado) {
    return NextResponse.json({ error: resultado.erro }, { status: 409 });
  }

  const { usuario: criado, senhaProvisoria } = resultado;
  const { enviado, erro: erroEnvio } = await enviarEmailBoasVindas({
    destinatario: criado.email,
    nomeCompleto: `${criado.nome} ${criado.sobrenome}`.trim(),
    senhaProvisoria,
  });

  return NextResponse.json(
    {
      usuario: semSenha(criado),
      emailEnviado: enviado,
      // só devolve a senha em texto puro quando o e-mail NÃO foi enviado —
      // é o jeito de quem cadastrou repassar manualmente nesse caso.
      senhaProvisoria: enviado ? undefined : senhaProvisoria,
      avisoEmail: enviado ? undefined : erroEnvio,
    },
    { status: 201 }
  );
}
