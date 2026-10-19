import { NextResponse } from "next/server";
import { pingGas } from "@/lib/mailer";

export async function POST() {
  try {
    const result = await pingGas();
    return NextResponse.json(result);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}
