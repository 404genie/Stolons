"use client";

import { useMemo, type ReactNode } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import {RPC_ENDPOINT} from "../lib/network";
import "@solana/wallet-adapter-react-ui/styles.css";

const connectionConfig = { commitment: "confirmed" as const, disableRetryOnRateLimit: true };

export function Providers({ children }: { children: ReactNode }) {
  const endpoint = RPC_ENDPOINT;
  const wallets = useMemo(() => [], []);
  return (
    <ConnectionProvider endpoint={endpoint} config={connectionConfig}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  );
}
