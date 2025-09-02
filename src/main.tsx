// src/main.tsx
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
// ------- Programmatic background using BASE_URL -------
const bgUrl = new URL('/assets/General backgroud.png', import.meta.env.BASE_URL).toString()

// Put background on <html> so it sits behind everything
document.documentElement.style.background = `url("${bgUrl}") center / cover fixed no-repeat`
// Remove any dark defaults
document.documentElement.style.setProperty('background-color', 'transparent')
document.body.style.background = 'transparent'
const rootEl = document.getElementById('root') as HTMLElement
rootEl.style.background = 'transparent'

// Add a soft dark overlay for readability
const overlay = document.createElement('div')
overlay.style.position = 'fixed'
overlay.style.inset = '0'
overlay.style.pointerEvents = 'none'
overlay.style.zIndex = '0'
overlay.style.background = 'rgba(0,0,0,0.45)' // tweak opacity as needed
document.body.prepend(overlay)

// Ensure the app renders above the overlay
rootEl.style.position = 'relative'
rootEl.style.zIndex = '1'
// ------------------------------------------------------

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
