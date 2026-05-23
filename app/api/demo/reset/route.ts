import { NextResponse } from "next/server";
import { resetState } from "@/lib/store";

export async function POST() {
  return NextResponse.json(resetState());
}
