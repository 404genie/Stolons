"use client";

import Link from "next/link";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

export function Navigation() {
  return (
    <header className="nav shell">
      <Link className="brand" href="/"><span className="brand-mark" />Stolons</Link>
      <nav className="nav-links">
        <Link href="/#protocol">Protocol</Link>
        <Link href="/#launch">Launch</Link>
        <WalletMultiButton style={{ height: 38, fontSize: 12, background: "#b4d28c", color: "#152010", borderRadius: 5 }} />
      </nav>
    </header>
  );
}
