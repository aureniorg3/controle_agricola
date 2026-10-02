import { listConferencias, listEquiptoFrente, listOrdensParaConferencia, usuarioAtual } from "@/lib/db";
import ConferenciaClient from "./ConferenciaClient";

export const dynamic = "force-dynamic";

export default async function ConferenciaPesagemPage() {
  const [conferencias, equiptos, ordens, usuario] = await Promise.all([
    listConferencias(),
    listEquiptoFrente(),
    listOrdensParaConferencia(),
    usuarioAtual(),
  ]);
  return (
    <ConferenciaClient
      linhas={conferencias}
      equiptos={equiptos}
      ordens={ordens}
      perfil={usuario?.perfil ?? "leitura"}
    />
  );
}
