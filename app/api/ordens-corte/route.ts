import { NextResponse } from "next/server";
import { listOrdens, listOrdensVisiveis } from "@/lib/db";

export async function GET() {
  const ordens = await listOrdens();
  const ordensVisiveis = await listOrdensVisiveis();
  return NextResponse.json({ ordens, ordensVisiveis });
}
