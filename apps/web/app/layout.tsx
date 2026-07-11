import { ConvexAuthNextjsServerProvider } from "@convex-dev/auth/nextjs/server";
import type { Metadata } from "next";
import { Bricolage_Grotesque, JetBrains_Mono, Public_Sans } from "next/font/google";
import type { ReactNode } from "react";
import "./globals.css";
import { Providers } from "./providers";

// Self-hosted at build time by next/font — no runtime request to Google.
const display = Bricolage_Grotesque({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  variable: "--font-display",
  display: "swap",
});

const body = Public_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-body",
  display: "swap",
});

const mono = JetBrains_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-mono",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://pikar-ai.com"),
  title: { default: "Pikar AI", template: "%s" },
  description: "Governed agentic AI operating layer",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  // ConvexAuthNextjsServerProvider must wrap <html> — it reads/writes the auth cookie
  // during SSR so the client provider hydrates already-authenticated.
  return (
    <ConvexAuthNextjsServerProvider>
      <html lang="en" className={`${display.variable} ${body.variable} ${mono.variable}`}>
        <body>
          <Providers>{children}</Providers>
        </body>
      </html>
    </ConvexAuthNextjsServerProvider>
  );
}
