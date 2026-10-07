import { notFound } from "next/navigation";
import PlaceholderPage from "@/components/PlaceholderPage";
import { CADASTROS } from "@/lib/cadastros";
import { specPorSlug } from "@/lib/cadastros-spec";
import { usuarioAtual } from "@/lib/db";
import { prepararOSAgr } from "@/lib/db-os-agr";
import CadastroClient from "./CadastroClient";

export const dynamic = "force-dynamic";

export default async function CadastroPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const item = CADASTROS.find((c) => c.slug === slug);
  if (!item) notFound();

  // cadastros com planilha já ligada ganham tela de verdade; os demais seguem "em construção"
  if (specPorSlug(slug)) {
    // Etapa e Tipo Aplicação têm carga inicial junto com a base de O.S.
    if (slug === "etapa" || slug === "tipo-aplicacao") await prepararOSAgr();
    const usuario = await usuarioAtual();
    return <CadastroClient slug={slug} perfil={usuario?.perfil ?? "leitura"} />;
  }

  return (
    <PlaceholderPage
      categoria="Configurações · Cadastros"
      titulo={item.label}
      descricao={`Cadastro de ${item.label.toLowerCase()} usado nos demais módulos do sistema.`}
    />
  );
}
