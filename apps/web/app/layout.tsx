import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Providers } from "./providers";
import "./globals.css";

export const metadata: Metadata = {
  title: "Stolons — Memecoins that reproduce",
  description: "A Solana launch protocol for independently traded token descendants.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "16x16 32x32 48x48", type: "image/x-icon" },
      { url: "/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icon-512.png", sizes: "512x512", type: "image/png" }
    ],
    apple: { url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }
  }
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
