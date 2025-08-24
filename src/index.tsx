import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { WagmiConfig, createConfig, configureChains, useAccount, useConnect, useDisconnect } from "wagmi";
import { baseGoerli } from "wagmi/chains";
import { publicProvider } from "wagmi/providers/public";
import { ConnectKitProvider, getDefaultConfig, ConnectKitButton } from "connectkit";
import { jsonRpcProvider } from "wagmi/providers/jsonRpc";
import { ethers } from "ethers";

const { chains, publicClient } = configureChains(
  [baseGoerli],
  [
    jsonRpcProvider({
      rpc: () => ({ http: "https://base-goerli.public.blastapi.io" })
    }),
    publicProvider()
  ]
);

const config = createConfig(
  getDefaultConfig({
    appName: "SAADverse",
    chains,
    publicClient,
    walletConnectProjectId: "YOUR_WALLETCONNECT_ID_HERE"
  })
);

const SAADPresaleAddress = "0xC0912c990fe376Bc74776b79BAf28456dAdDC055";
const SAADPresaleABI = [
  "function buyWithETH() public payable",
  "function buyWithUSDT(uint256 usdtAmount) public"
];

function App() {
  const { address, isConnected } = useAccount();
  const { disconnect } = useDisconnect();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("");

  async function handleBuyETH() {
    if (!window.ethereum || !isConnected) {
      alert("Please connect your wallet first.");
      return;
    }
    try {
      setLoading(true);
      setStatus("Sending transaction...");
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const presaleContract = new ethers.Contract(SAADPresaleAddress, SAADPresaleABI, signer);
      const tx = await presaleContract.buyWithETH({ value: ethers.parseEther("0.01") });
      await tx.wait();
      setStatus("✅ Transaction successful!");
    } catch (err) {
      console.error(err);
      setStatus("❌ Transaction failed.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8 bg-gradient-to-b from-gray-950 to-black text-white">
      <h1 className="text-5xl font-bold mb-4 text-center text-green-400 animate-pulse">
        Welcome to SAADverse
      </h1>
      <p className="text-lg mb-8 max-w-2xl text-center">
        Join the most hyped presale of the year. Buy $SQ8 using ETH, USDT, credit/debit cards, or PayPal.
      </p>
      <ConnectKitButton />

      <div className="bg-black border border-green-500 rounded-xl p-8 shadow-xl w-full max-w-xl mt-6">
        <h2 className="text-2xl font-semibold mb-4 text-green-300">
          Phase 1 – Price: $0.0016 per SQ8
        </h2>
        <button
          onClick={handleBuyETH}
          disabled={loading}
          className="w-full py-3 px-6 mb-4 bg-green-600 hover:bg-green-700 rounded text-white font-semibold transition"
        >
          Buy with ETH
        </button>
        <button
          className="w-full py-3 px-6 mb-4 bg-blue-600 hover:bg-blue-700 rounded text-white font-semibold transition"
          disabled
        >
          Buy with USDT (Coming Soon)
        </button>
        <button
          className="w-full py-3 px-6 mb-4 bg-yellow-500 hover:bg-yellow-600 rounded text-black font-semibold transition"
          disabled
        >
          Buy with Credit/Debit (Coming Soon)
        </button>
        <button
          className="w-full py-3 px-6 mb-4 bg-white hover:bg-gray-200 rounded text-black font-semibold transition"
          disabled
        >
          PayPal / Apple Pay (Coming Soon)
        </button>
        {status && <p className="text-center mt-2 text-sm text-gray-300">{status}</p>}
      </div>

      <p className="text-sm text-gray-400 mt-6">
        Contract is deployed on Base Testnet | SAADverse © 2025
      </p>
    </div>
  );
}

const container = document.getElementById("root");
const root = createRoot(container);

root.render(
  <WagmiConfig config={config}>
    <ConnectKitProvider>
      <App />
    </ConnectKitProvider>
  </WagmiConfig>
);
