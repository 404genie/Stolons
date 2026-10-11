"use client";

import Link from "next/link";
import Image from "next/image";
import dynamic from "next/dynamic";
import { usePathname } from "next/navigation";

const WalletMultiButton = dynamic(() => import("@solana/wallet-adapter-react-ui").then(module => module.WalletMultiButton), { ssr: false, loading: () => <button className="wallet-placeholder" disabled>Connect wallet</button> });
export function Navigation() {
  const path = usePathname();
  return <header className="site-header"><div className="nav shell">
    <Link className="brand" href="/" aria-label="Stolons home"><Image className="brand-mark" src="/stolons-logo.webp" alt="" width={36} height={36} priority /><span>stolons<span className="brand-period">.</span></span></Link>
    <nav className="nav-links" aria-label="Main navigation"><Link className={path === "/" ? "active" : ""} href="/">Discover</Link><Link className={path === "/launch" ? "active" : ""} href="/launch">Create token</Link><Link href="/#protocol">How it works</Link></nav>
    <div className="nav-account"><span className="network-badge"><i />Devnet</span><WalletMultiButton /></div>
  </div></header>;
}
