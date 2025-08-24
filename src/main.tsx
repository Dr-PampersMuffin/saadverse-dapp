// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";

import { WagmiConfig, createConfig, configureChains } from "wagmi";
import { base } from "wagmi/chains";
import { jsonRpcProvider } from "wagmi/providers/jsonRpc";
import { InjectedConnector } from "wagmi/connectors/injected";

// Base mainnet only
const { chains, publicClient, webSocketPublicClient } = configureChains(
  [base],
  [
    jsonRpcProvider({
      rpc: () => ({
        // You can swap this to your Alchemy/QuickNode for better rate limits
        http: "https://mainnet.base.org",
      }),
    }),
  ]
);

const config = createConfig({
  autoConnect: true,
  connectors: [new InjectedConnector({ chains })],
  publicClient,
  webSocketPublicClient,
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <WagmiConfig config={config}>
      <App />
    </WagmiConfig>
  </React.StrictMode>
);
