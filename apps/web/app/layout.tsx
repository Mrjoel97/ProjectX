import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import "./fonts.css";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  metadataBase: new URL("https://pikar-ai.com"),
  title: { default: "Pikar AI", template: "%s" },
  description: "Governed agentic AI operating layer",
  verification: { google: "kaMoPf-oKXQgk1kbCkQkIlqHDmRuSJlFyj-T504HlD8" },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // ConvexAuthNextjsServerProvider must wrap <html> — it reads/writes the auth cookie
  // during SSR so the client provider hydrates already-authenticated.
  return (
    <ConvexAuthNextjsServerProvider>
      <html lang="en">
        <head>
          <link
            rel="preload"
            href="/fonts/4fd48b2c1ab27220e71f15f990550261b35245c3bdfd8d8025b4bdac0459ee2d.woff2"
            as="font"
            type="font/woff2"
            crossOrigin="anonymous"
          />
          <link
            rel="preload"
            href="/fonts/c1b6da516e0062e9c2f341b3a51dd2d621d946da72f06c6cfe05fd9d2dd8622d.woff2"
            as="font"
            type="font/woff2"
            crossOrigin="anonymous"
          />
          <link
            rel="preload"
            href="/fonts/2c32b9b3ee358c119e210f6f5195f9bd34894d78a785ff2e95d60e718e400af4.woff2"
            as="font"
            type="font/woff2"
            crossOrigin="anonymous"
          />
        </head>
        <body>
          <Providers>{children}</Providers>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
