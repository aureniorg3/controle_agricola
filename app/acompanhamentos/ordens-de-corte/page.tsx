import { listOrdens } from "@/lib/db";
import OrdensCorteClient from "./OrdensCorteClient";

export const dynamic = "force-dynamic";

export default function OrdensDeCortePage() {
  const ordens = listOrdens();
  return <OrdensCorteClient initialOrdens={ordens} />;
}
