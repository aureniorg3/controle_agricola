import { agregarSafras, agregarVariedadeCorte } from "@/lib/db";
import { dadosPainelColheita } from "@/lib/db-colheita-painel";
import ColheitaPainelClient from "./ColheitaPainelClient";

export const dynamic = "force-dynamic";

export default async function ColheitaPage() {
  const hoje = new Date().toLocaleDateString("sv-SE", { timeZone: "America/Sao_Paulo" });
  const [safras, fazenda, proprietario, municipio, variedade, corte, variedadeCorte, porTipoPropriedade] = await Promise.all([
    agregarSafras("safra"),
    agregarSafras("fazenda"),
    agregarSafras("proprietario"),
    agregarSafras("municipio"),
    agregarSafras("variedade"),
    agregarSafras("corte"),
    agregarVariedadeCorte(),
    // filtro Tipo de propriedade (Cadastro de Fazenda) e as caixas das ordens de corte da safra atual; se falhar, o
    // painel segue como antes (sem o filtro e sem essas caixas)
    dadosPainelColheita(hoje).catch((err) => {
      console.error("Moagem Dashboard: tipos de propriedade e ordens da safra não carregados:", err);
      return null;
    }),
  ]);
  return (
    <ColheitaPainelClient
      safras={safras}
      dimensoes={{ fazenda, proprietario, municipio, variedade, corte }}
      variedadeCorte={variedadeCorte}
      tipos={porTipoPropriedade?.tipos ?? []}
      porTipo={porTipoPropriedade?.porTipo ?? null}
      ordensSafra={porTipoPropriedade?.ordensSafra ?? null}
    />
  );
}
