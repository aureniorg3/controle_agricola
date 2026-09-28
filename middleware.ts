import { NextRequest, NextResponse } from "next/server";

/**
 * Gate leve: só checa se o cookie de sessão existe (o middleware roda em
 * Edge Runtime, que não tem o módulo `crypto` do Node — por isso a
 * assinatura só é validada de verdade no layout do grupo autenticado,
 * que roda em Node.js). Isso evita alguém navegar direto para uma tela
 * interna sem cookie nenhum; a validação completa (assinatura + validade)
 * acontece em app/(app)/layout.tsx antes de qualquer dado ser carregado.
 */
const SESSION_COOKIE_NAME = "ca_session";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const temCookie = Boolean(req.cookies.get(SESSION_COOKIE_NAME)?.value);

  if (pathname === "/login") {
    return NextResponse.next();
  }

  if (!temCookie) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon.ico).*)"],
};
