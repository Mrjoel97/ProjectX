import { Sandbox } from "@vercel/sandbox";
import { handlePresenceReviewRequest } from "./runner";

export const runtime = "nodejs";
export const maxDuration = 300;

/** Automatic Vercel OIDC only: never accepts caller credentials, deployment tokens or URLs. */
export async function POST(req: Request): Promise<Response> {
  return handlePresenceReviewRequest(req, {
    secret: process.env.PRESENCE_BROWSER_REVIEW_SECRET,
    snapshotId: process.env.PRESENCE_BROWSER_SNAPSHOT_ID,
    deploymentUrl: process.env.NEXT_PUBLIC_CONVEX_URL,
    fetch: globalThis.fetch,
    createSandbox: async (options) => {
      const sandbox = await Sandbox.create(options);
      return {
        mkDir: (path) => sandbox.mkDir(path),
        writeFiles: (files) =>
          sandbox.writeFiles(
            files.map((file) => ({ path: file.path, content: Buffer.from(file.content) })),
          ),
        runCommand: (cmd, args) => sandbox.runCommand(cmd, args),
        readFileToBuffer: async (file) => {
          const bytes = await sandbox.readFileToBuffer(file);
          return bytes ? Uint8Array.from(bytes) : null;
        },
        stop: () => sandbox.stop(),
      };
    },
  });
}
