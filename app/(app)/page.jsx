import { redirect } from "next/navigation";

/** A entrada do sistema é sempre o Início / Dashboard. */
export default function RootPage() {
  redirect("/painel");
}
