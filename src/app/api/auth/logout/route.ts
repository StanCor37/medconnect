import { destroyCurrentSession } from "@/lib/session";

export async function POST() {
  await destroyCurrentSession();
  return new Response(null, { status: 204 });
}
