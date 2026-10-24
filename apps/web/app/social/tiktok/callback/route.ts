import { callback } from "../../_relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The official review flow uses only the explicit owned review origin. */
export async function GET(request: Request): Promise<Response> {
  return callback(request, "tiktok");
}
