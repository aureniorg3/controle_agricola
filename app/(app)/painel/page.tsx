import { dadosPainel } from "@/lib/db-painel";
import { todayISO } from "@/lib/format";
import PainelView from "./PainelView";

export const dynamic = "force-dynamic";

export default async function Page() {
  return <PainelView d={await dadosPainel(todayISO())} />;
}
