import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stolons — Memecoins that reproduce",
  description: "A Solana launch protocol for independently traded token descendants."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // Wallet extensions can add attributes to this element before hydration.
    <html lang="en" suppressHydrationWarning>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
