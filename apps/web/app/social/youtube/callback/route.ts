import { callback } from "../../_relay";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Code/state go only to the fixed build-configured backend, never into a browser redirect. */
export async function GET(request: Request): Promise<Response> {
  return callback(request, "youtube");
}
