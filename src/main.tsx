// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

import { WagmiConfig, configureChains, createConfig } from "wagmi";
import { base } from "wagmi/chains";
import { jsonRpcProvider } from "wagmi/providers/jsonRpc";

// Use a reliable Base mainnet RPC
const BASE_RPC = import.meta.env.VITE_BASE_MAINNET_RPC || "https://rpc.ankr.com/base/b2f2e2cb3aa48877888eb3974f552ff4da4b442616b24a4eb9f5e4b9947ddeff";

const { chains, publicClient, webSocketPublicClient } = configureChains(
  [base],
  [
    jsonRpcProvider({
      rpc: () => ({ http: BASE_RPC }),
    }),
  ]
);

// Minimal injected connector (MetaMask, Coinbase Wallet extension, Trust Wallet extension)
import { InjectedConnector } from "wagmi/connectors/injected";
const config = createConfig({
  autoConnect: true,
  publicClient,
  webSocketPublicClient,
  connectors: [new InjectedConnector({ chains })],
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WagmiConfig config={config}>
      <App />
    </WagmiConfig>
  </React.StrictMode>
);