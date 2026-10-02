import { agregarSafras } from "@/lib/db";
import ColheitaPainelClient from "./ColheitaPainelClient";

export const dynamic = "force-dynamic";

export default async function ColheitaPage() {
  const [safras, fazenda, proprietario, municipio, variedade, corte] = await Promise.all([
    agregarSafras("safra"),
    agregarSafras("fazenda"),
    agregarSafras("proprietario"),
    agregarSafras("municipio"),
    agregarSafras("variedade"),
    agregarSafras("corte"),
  ]);
  return (
    <ColheitaPainelClient
      safras={safras}
      dimensoes={{ fazenda, proprietario, municipio, variedade, corte }}
    />
  );
}
