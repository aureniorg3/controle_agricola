import { NextResponse } from "next/server";
import { listOrdens } from "@/lib/db";

export async function GET() {
  const ordens = listOrdens();
  return NextResponse.json({ ordens });
}
