import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "crypto";

/**
 * Autenticação simples por cookie assinado, sem dependências externas
 * (sem next-auth/jsonwebtoken) — usa só o módulo `crypto` do Node, para não
 * depender de `npm install` de pacotes novos. Roda em ambiente Node.js
 * (Server Components e Route Handlers), nunca no middleware (Edge Runtime
 * não tem o módulo `crypto` do Node) — por isso o `middleware.js` só checa
 * se o cookie existe; quem valida a assinatura de verdade é o layout do
 * grupo autenticado, antes de renderizar qualquer tela.
 */

export const SESSION_COOKIE_NAME = "ca_session";
export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 dias

function getSecret() {
  // Em produção, defina AUTH_SECRET nas variáveis de ambiente do serviço
  // (Render → Environment). Sem isso, um valor fixo de desenvolvimento é
  // usado — funciona, mas qualquer um com o código consegue forjar sessões.
  return process.env.AUTH_SECRET || "controle-agricola-dev-secret-trocar-em-producao";
}

/** Senha padrão de todo usuário novo; ele é obrigado a trocar no primeiro acesso (`precisaTrocarSenha`). */
export const SENHA_PADRAO_NOVO_USUARIO = "inicio123";

/** Senha provisória legível (sem 0/O/1/l/I, que se confundem ao digitar),
 * gerada na criação de um usuário — ele troca por uma definitiva no
 * primeiro acesso (ver `precisaTrocarSenha`). */
export function gerarSenhaProvisoria() {
  const alfabeto = "ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  const bytes = randomBytes(10);
  let senha = "";
  for (let i = 0; i < 10; i++) senha += alfabeto[bytes[i] % alfabeto.length];
  return senha;
}

export function hashSenha(senhaPlana) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(senhaPlana, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export function verificarSenha(senhaPlana, senhaHash) {
  const [salt, hashArmazenado] = senhaHash.split(":");
  if (!salt || !hashArmazenado) return false;
  const calculado = scryptSync(senhaPlana, salt, 64);
  const armazenado = Buffer.from(hashArmazenado, "hex");
  if (armazenado.length !== calculado.length) return false;
  return timingSafeEqual(calculado, armazenado);
}

function assinar(dado) {
  return createHmac("sha256", getSecret()).update(dado).digest("base64url");
}

export function criarTokenSessao(userId) {
  const payload = {
    uid: userId,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE_SECONDS,
  };
  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${payloadB64}.${assinar(payloadB64)}`;
}

/** Retorna o id do usuário se o token for válido (assinatura + validade), senão null. */
export function verificarTokenSessao(token) {
  if (!token) return null;
  const [payloadB64, assinatura] = token.split(".");
  if (!payloadB64 || !assinatura) return null;

  const esperada = assinar(payloadB64);
  const bufRecebido = Buffer.from(assinatura);
  const bufEsperado = Buffer.from(esperada);
  if (bufRecebido.length !== bufEsperado.length || !timingSafeEqual(bufRecebido, bufEsperado)) {
    return null;
  }

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf-8"));
    if (!payload.uid || typeof payload.exp !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload.uid;
  } catch {
    return null;
  }
}
