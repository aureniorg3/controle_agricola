import { Resend } from "resend";

/**
 * Envio de e-mail via Resend (resend.com). Sem `RESEND_API_KEY` configurada
 * (variável de ambiente do serviço, ver README → "Deploy no Render"),
 * `enviarEmailBoasVindas` não tenta enviar nada e retorna `enviado: false` —
 * quem chamar mostra a senha provisória na tela como alternativa, em vez de
 * travar o cadastro de usuário esperando um serviço de e-mail existir.
 */

function getUrlSistema(): string {
  return process.env.APP_URL || "https://controle-agricola.onrender.com";
}

function getRemetente(): string {
  // "onboarding@resend.dev" funciona sem verificar domínio — só entrega pro
  // próprio e-mail da conta Resend. Depois de verificar um domínio seu em
  // resend.com/domains, troque RESEND_FROM_EMAIL pra algo como
  // "controle-agricola@seudominio.com.br".
  return process.env.RESEND_FROM_EMAIL || "onboarding@resend.dev";
}

export async function enviarEmailBoasVindas(params: {
  destinatario: string;
  nomeCompleto: string;
  senhaProvisoria: string;
}): Promise<{ enviado: boolean; erro?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    return { enviado: false, erro: "RESEND_API_KEY não configurada." };
  }

  const urlSistema = getUrlSistema();
  const resend = new Resend(apiKey);

  try {
    const { error } = await resend.emails.send({
      from: `Controle Agrícola <${getRemetente()}>`,
      to: params.destinatario,
      subject: "Seu acesso ao Controle Agrícola — CRV Industrial",
      html: `
        <div style="font-family: Arial, Helvetica, sans-serif; max-width: 480px; margin: 0 auto; color: #141a24;">
          <h2 style="color: #0d2140;">Controle Agrícola — CRV Industrial</h2>
          <p>Olá, ${params.nomeCompleto},</p>
          <p>Uma conta foi criada pra você no Controle Agrícola. Seus dados de acesso:</p>
          <table style="margin: 16px 0;">
            <tr><td style="padding: 4px 8px; color: #5c6675;">Sistema:</td><td style="padding: 4px 8px;"><a href="${urlSistema}">${urlSistema}</a></td></tr>
            <tr><td style="padding: 4px 8px; color: #5c6675;">Usuário (e-mail):</td><td style="padding: 4px 8px;">${params.destinatario}</td></tr>
            <tr><td style="padding: 4px 8px; color: #5c6675;">Senha provisória:</td><td style="padding: 4px 8px; font-family: monospace; font-size: 15px;"><b>${params.senhaProvisoria}</b></td></tr>
          </table>
          <p>No primeiro acesso, o sistema vai pedir pra você trocar essa senha por uma definitiva.</p>
          <p style="color: #5c6675; font-size: 12px; margin-top: 24px;">Se você não esperava este e-mail, ignore-o ou avise o administrador do sistema.</p>
        </div>
      `,
    });
    if (error) return { enviado: false, erro: error.message };
    return { enviado: true };
  } catch (e) {
    return { enviado: false, erro: e instanceof Error ? e.message : String(e) };
  }
}
