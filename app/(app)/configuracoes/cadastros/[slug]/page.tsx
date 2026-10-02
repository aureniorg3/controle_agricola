import { notFound } from "next/navigation";
import PlaceholderPage from "@/components/PlaceholderPage";
import { CADASTROS } from "@/lib/cadastros";

export default async function CadastroPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const item = CADASTROS.find((c) => c.slug === slug);
  if (!item) notFound();
  return (
    <PlaceholderPage
      categoria="Configurações · Cadastros"
      titulo={item.label}
      descricao={`Cadastro de ${item.label.toLowerCase()} usado nos demais módulos do sistema.`}
    />
  );
}
