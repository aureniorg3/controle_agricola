import { NextResponse } from "next/server";
import { listOrdens, listOrdensVisiveis } from "@/lib/db";

export async function GET() {
  const ordens = listOrdens();
  const ordensVisiveis = listOrdensVisiveis();
  return NextResponse.json({ ordens, ordensVisiveis });
}
