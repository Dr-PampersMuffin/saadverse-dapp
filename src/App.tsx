import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";

/** =========================
 *  CONFIG – EDIT THESE
 *  ========================= */
const PRESALE_ADDRESS = "0x00ab2677723295F2d0A79cb68E1893f9707B409D";
const USDT_ADDRESS = "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2";
const USDT_DECIMALS = 6;

/**
 * Minimal ABIs for functions used below. Replace with your full ABIs if you have them.
 */
const SAAD_PRESALE_USD_PRO_ABI = [
  // Buy methods
  "function buyWithETH() payable",
  "function buyWithUSDT(uint256 amount) returns (bool)",

  // Read helpers (adjust to your contract if names differ)
  "function priceUSDT6() view returns (uint256)",   // price per SQ8 in USDT with 6 decimals
  "function getEthUsd6() view returns (uint256)",   // ETH price in USD*1e6 (e.g., 3500.00 => 3500000000)

  // You may have more; add here as needed (caps, totals, etc.)
];

const ERC20_MIN_ABI = [
  "function decimals() view returns (uint8)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function balanceOf(address owner) view returns (uint256)",
];

/** =========================
 *  ETHERS HELPERS
 *  ========================= */
function getProvider(): ethers.BrowserProvider {
  const { ethereum } = window as any;
  if (!ethereum) throw new Error("No injected wallet detected. Please install MetaMask or a compatible wallet.");
  return new ethers.BrowserProvider(ethereum);
}

async function getSigner(): Promise<ethers.Signer> {
  const provider = getProvider();
  await provider.send("eth_requestAccounts", []);
  return await provider.getSigner();
}

/** =========================
 *  MAIN APP
 *  ========================= */
export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [account, setAccount] = useState<string>("");
  const [chainId, setChainId] = useState<number | null>(null);

  const [ethAmount, setEthAmount] = useState<string>("");
  const [usdtAmount, setUsdtAmount] = useState<string>("");

  // “Smart” buy: request SQ8 amount and compute needed ETH/USDT
  const [desiredTokens, setDesiredTokens] = useState<string>("");

  // Pricing
  const [priceUSDT6, setPriceUSDT6] = useState<bigint>(0n); // USDT price per SQ8 in 1e6
  const [ethUsd6, setEthUsd6] = useState<bigint>(0n); // USD per 1 ETH in 1e6

  // UI state
  const [loading, setLoading] = useState(false);
  const [txStatus, setTxStatus] = useState<string>("");

  const presaleInterface = useMemo(() => new ethers.Interface(SAAD_PRESALE_USD_PRO_ABI), []);
  const erc20Interface = useMemo(() => new ethers.Interface(ERC20_MIN_ABI), []);

  /** Connect wallet & track */
  useEffect(() => {
    const { ethereum } = window as any;
    if (!ethereum) return;

    const handleAccountsChanged = (accs: string[]) => {
      const a = accs?.[0] || "";
      setAccount(a);
      setIsConnected(!!a);
    };

    const handleChainChanged = (cidHex: string) => {
      const id = parseInt(cidHex, 16);
      setChainId(id);
    };

    ethereum.request({ method: "eth_accounts" }).then((accs: string[]) => {
      handleAccountsChanged(accs);
    });

    ethereum.request({ method: "eth_chainId" }).then((cidHex: string) => {
      handleChainChanged(cidHex);
    });

    ethereum.on?.("accountsChanged", handleAccountsChanged);
    ethereum.on?.("chainChanged", handleChainChanged);

    return () => {
      ethereum.removeListener?.("accountsChanged", handleAccountsChanged);
      ethereum.removeListener?.("chainChanged", handleChainChanged);
    };
  }, []);

  /** Read contract pricing: priceUSDT6 and ethUsd6 */
  async function readState(signerOrProvider?: ethers.Signer | ethers.Provider) {
    try {
      const provider = signerOrProvider ?? getProvider();
      const presale = new ethers.Contract(PRESALE_ADDRESS, presaleInterface, provider);

      const [p6, e6] = await Promise.all([
        presale.priceUSDT6().catch(() => 0n),
        presale.getEthUsd6().catch(() => 0n),
      ]);

      if (p6 && typeof p6 === "bigint") setPriceUSDT6(p6);
      if (e6 && typeof e6 === "bigint") setEthUsd6(e6);
    } catch (e) {
      console.warn("readState:", e);
    }
  }

  useEffect(() => {
    readState().catch(() => {});
  }, []);

  /** Connect button */
  async function connect() {
    try {
      const signer = await getSigner();
      const addr = await signer.getAddress();
      setAccount(addr);
      setIsConnected(true);

      const net = await (signer.provider as ethers.BrowserProvider).getNetwork();
      setChainId(Number(net.chainId));
      await readState(signer);
    } catch (e: any) {
      alert(e?.message || String(e));
    }
  }

  /** Buy with ETH */
  async function handleBuyETH() {
    if (!isConnected) return alert("Connect wallet first.");
    try {
      setLoading(true);
      setTxStatus("Sending ETH transaction…");

      const signer = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, presaleInterface, signer);

      // parse input or default to small value to avoid empty tx
      const value = ethers.parseEther((ethAmount && ethAmount.trim()) || "0.001");

      // preflight simulate
      try {
        await presale.buyWithETH({ value, gasLimit: 300000n }).then(() => {});
      } catch {
        // Some RPCs don't allow .callStatic with ethers v6 shorthand;
        // we do a try/catch around actual send instead.
      }

      const tx = await presale.buyWithETH({ value, gasLimit: 300000n });
      setTxStatus(`Pending… ${tx.hash}`);
      await tx.wait();

      await readState(signer);
      setTxStatus("✅ ETH purchase successful!");
    } catch (err: any) {
      console.error(err);
      setTxStatus(`❌ Failed: ${err?.reason || err?.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  /** Buy with USDT */
  async function handleBuyUSDT() {
    if (!isConnected) return alert("Connect wallet first.");
    try {
      setLoading(true);
      setTxStatus("Buying with USDT…");

      const signer = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, presaleInterface, signer);
      const usdt = new ethers.Contract(USDT_ADDRESS, erc20Interface, signer);

      const owner = await signer.getAddress();
      const amount = ethers.parseUnits((usdtAmount || "0").trim(), USDT_DECIMALS);

      // approve if needed
      const current = (await usdt.allowance(owner, PRESALE_ADDRESS)) as bigint;
      if (current < amount) {
        setTxStatus("Approving USDT…");
        const txA = await usdt.approve(PRESALE_ADDRESS, amount);
        await txA.wait();
      }

      // preflight simulate (optional)
      try {
        await presale.buyWithUSDT(amount);
      } catch {
        // ignore simulate error, proceed to send for chains that block simulation
      }

      const tx = await presale.buyWithUSDT(amount);
      setTxStatus(`Pending… ${tx.hash}`);
      await tx.wait();

      await readState(signer);
      setTxStatus("✅ USDT purchase successful!");
    } catch (err: any) {
      console.error(err);
      setTxStatus(`❌ USDT buy failed: ${err?.reason || err?.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  /** SMART: Buy by desired SQ8 amount, compute needed ETH using price + oracle */
  async function handleSmartBuyETH() {
    if (!isConnected) return alert("Connect wallet first.");
    try {
      setLoading(true);
      setTxStatus("Preparing ETH purchase…");

      const tokensWanted = parseFloat((desiredTokens || "").trim());
      if (!tokensWanted || tokensWanted <= 0) throw new Error("Enter SQ8 amount > 0");

      if (!priceUSDT6 || !ethUsd6) throw new Error("Pricing unavailable. Try again in a moment.");

      const signer = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, presaleInterface, signer);

      // usd6 = tokensWanted * priceUSDT6
      const usd6 = BigInt(Math.ceil(tokensWanted * Number(priceUSDT6)));

      // Convert USD (1e6) to ETH wei: wei = (usd6 * 1e18) / ethUsd6
      let ethWei = (usd6 * 1_000_000_000_000_000_000n) / ethUsd6;
      // Add small buffer for rounding/slippage
      ethWei = (ethWei * 102n) / 100n;

      // preflight simulate optional
      try {
        await presale.buyWithETH({ value: ethWei, gasLimit: 300000n });
      } catch {
        // ignore simulate error
      }

      const tx = await presale.buyWithETH({ value: ethWei, gasLimit: 300000n });
      setTxStatus(`Pending… ${tx.hash}`);
      await tx.wait();

      await readState(signer);
      setTxStatus("✅ ETH purchase successful!");
    } catch (e: any) {
      console.error(e);
      setTxStatus(`❌ Failed: ${e?.reason || e?.message || String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  /** SMART: Buy by desired SQ8 amount with USDT */
  async function handleSmartBuyUSDT() {
    if (!isConnected) return alert("Connect wallet first.");
    try {
      setLoading(true);
      setTxStatus("Preparing USDT purchase…");

      const tokensWanted = parseFloat((desiredTokens || "").trim());
      if (!tokensWanted || tokensWanted <= 0) throw new Error("Enter SQ8 amount > 0");

      if (!priceUSDT6) throw new Error("Price unavailable. Try again in a moment.");

      const signer = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, presaleInterface, signer);
      const usdt = new ethers.Contract(USDT_ADDRESS, erc20Interface, signer);
      const owner = await signer.getAddress();

      // usd6 = tokensWanted * priceUSDT6
      const usd6 = BigInt(Math.ceil(tokensWanted * Number(priceUSDT6)));

      // Approve if needed
      const current = (await usdt.allowance(owner, PRESALE_ADDRESS)) as bigint;
      if (current < usd6) {
        setTxStatus("Approving USDT…");
        const txA = await usdt.approve(PRESALE_ADDRESS, usd6);
        await txA.wait();
      }

      // Buy
      try {
        await presale.buyWithUSDT(usd6);
      } catch {
        // ignore simulate error
      }

      const tx = await presale.buyWithUSDT(usd6);
      setTxStatus(`Pending… ${tx.hash}`);
      await tx.wait();

      await readState(signer);
      setTxStatus("✅ USDT purchase successful!");
    } catch (e: any) {
      console.error(e);
      setTxStatus(`❌ Failed: ${e?.reason || e?.message || String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  /** ---------- UI ---------- */
  return (
    <div
      className="app"
      style={{
        minHeight: "100vh",
        padding: 24,
        color: "#fff",
        background: "transparent", // important for your page background to show
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16 }}>
        <button onClick={connect} disabled={isConnected} style={{ padding: "10px 14px", borderRadius: 8 }}>
          {isConnected ? "Wallet Connected" : "Connect Wallet"}
        </button>
        <div style={{ fontSize: 12, opacity: 0.85 }}>
          {account ? `Acct: ${account.slice(0, 6)}…${account.slice(-4)}` : "Not connected"}
          {chainId ? ` • ChainID: ${chainId}` : ""}
        </div>
      </div>

      <div style={{ display: "grid", gap: 16 }}>
        <section
          style={{
            background: "rgba(0,0,0,0.4)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 12,
            padding: 16,
          }}
        >
          <h3 style={{ marginTop: 0 }}>Buy with ETH</h3>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              inputMode="decimal"
              placeholder="ETH amount (e.g. 0.01)"
              value={ethAmount}
              onChange={(e) => setEthAmount(e.target.value)}
              style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)" }}
            />
            <button onClick={handleBuyETH} disabled={loading} style={{ padding: "10px 14px", borderRadius: 8 }}>
              Buy
            </button>
          </div>
        </section>

        <section
          style={{
            background: "rgba(0,0,0,0.4)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 12,
            padding: 16,
          }}
        >
          <h3 style={{ marginTop: 0 }}>Buy with USDT</h3>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text"
              inputMode="decimal"
              placeholder={`USDT amount (${USDT_DECIMALS} dp)`}
              value={usdtAmount}
              onChange={(e) => setUsdtAmount(e.target.value)}
              style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)" }}
            />
            <button onClick={handleBuyUSDT} disabled={loading} style={{ padding: "10px 14px", borderRadius: 8 }}>
              Buy
            </button>
          </div>
        </section>

        <section
          style={{
            background: "rgba(0,0,0,0.4)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 12,
            padding: 16,
          }}
        >
          <h3 style={{ marginTop: 0 }}>Smart Buy by SQ8 amount</h3>
          <div style={{ display: "grid", gap: 8 }}>
            <div>Price (USDT 6dp / SQ8): <b>{priceUSDT6.toString()}</b></div>
            <div>ETH USD (6dp): <b>{ethUsd6.toString()}</b></div>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                type="text"
                inputMode="decimal"
                placeholder="Desired SQ8 amount"
                value={desiredTokens}
                onChange={(e) => setDesiredTokens(e.target.value)}
                style={{ flex: 1, padding: 10, borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)" }}
              />
              <button onClick={handleSmartBuyETH} disabled={loading} style={{ padding: "10px 14px", borderRadius: 8 }}>
                Buy with ETH
              </button>
              <button onClick={handleSmartBuyUSDT} disabled={loading} style={{ padding: "10px 14px", borderRadius: 8 }}>
                Buy with USDT
              </button>
            </div>
          </div>
        </section>

        {!!txStatus && (
          <div
            style={{
              background: "rgba(0,0,0,0.4)",
              border: "1px solid rgba(255,255,255,0.12)",
              borderRadius: 12,
              padding: 12,
              fontSize: 14,
            }}
          >
            {txStatus}
          </div>
        )}
      </div>
    </div>
  );
}
