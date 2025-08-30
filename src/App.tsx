// src/App.tsx
import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { InjectedConnector } from "wagmi/connectors/injected";

import {
  ACTIVE_CHAIN,                // { id: 8453, name: "Base" }
  PRESALE_ADDRESS,             // SAADPresaleUSD_Pro on Base
  USDT_ADDRESS,                // 6-decimals stable (USDT/USDC)
  SAAD_ADDRESS,                // SQ8 token (for balances if you want)
  TRANSAK_ENV_URL,
  TRANSAK_API_KEY,
  COINBASE_CHECKOUT_ID,
} from "./constants";

import {
  SAAD_PRESALE_USD_ABI,
  ERC20_MIN_ABI,
} from "./abi";

/** small format helpers */
const fmt = (n: bigint, d = 18) => Number(n) / Number(10n ** BigInt(d));
const toFixed = (v: number, dp = 4) => (Number.isFinite(v) ? v.toFixed(dp) : "0.0000");

export default function App() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect({ connector: new InjectedConnector() });
  const { disconnect } = useDisconnect();

  const [loading, setLoading] = useState(false);
  const [txStatus, setTxStatus] = useState("");

  // ---- Phase / price / progress ----
  const [phase, setPhase] = useState<number>(0);
  const [priceUSDT6, setPriceUSDT6] = useState<bigint>(1600n); // $0.0016 default
  const [phaseCap, setPhaseCap] = useState<bigint>(0n);
  const [phaseSold, setPhaseSold] = useState<bigint>(0n);
  const progressPct = useMemo(() => {
    if (phaseCap === 0n) return 0;
    const pct = Number((phaseSold * 10000n) / phaseCap) / 100; // 2 dp
    return Math.max(0, Math.min(100, pct));
  }, [phaseCap, phaseSold]);

  // ---- Claim info ----
  const [claimedByMe, setClaimedByMe] = useState<bigint>(0n);
  const [unlockedByMe, setUnlockedByMe] = useState<bigint>(0n);
  const [claimableByMe, setClaimableByMe] = useState<bigint>(0n);
  const [claimStart, setClaimStart] = useState<number>(0);
  const [cliffSeconds, setCliffSeconds] = useState<number>(0);
  const [vestingDuration, setVestingDuration] = useState<number>(0);
  const [nextUnlockIn, setNextUnlockIn] = useState<string>("–");

  // ---- Manual ETH/USDT (kept) ----
  const [ethAmount, setEthAmount] = useState<string>("");
  const [usdtAmount, setUsdtAmount] = useState<string>("");

  // ---- USDT bookkeeping (approve/balance) ----
  const [usdtDecimals, setUsdtDecimals] = useState<number>(6);
  const [usdtAllowance, setUsdtAllowance] = useState<bigint>(0n);
  const [usdtBalance, setUsdtBalance] = useState<bigint>(0n);

  const needsApprove = useMemo(() => {
    try {
      const want = ethers.parseUnits(usdtAmount || "0", usdtDecimals);
      return usdtAllowance < want;
    } catch { return true; }
  }, [usdtAllowance, usdtAmount, usdtDecimals]);

  // ---- SMART PURCHASE (buy by SQ8 amount) ----
  const [desiredSq8, setDesiredSq8] = useState<string>(""); // tokens desired

  // ===== helpers =====
  async function getProvider() {
    const eth = (window as any).ethereum;
    if (!eth) throw new Error("No wallet detected. Install MetaMask or a compatible wallet.");
    return new ethers.BrowserProvider(eth);
  }

  async function ensureBaseChain(provider: ethers.BrowserProvider) {
    const net = await provider.getNetwork();
    if (net.chainId !== BigInt(ACTIVE_CHAIN.id)) {
      try {
        await (provider as any).send("wallet_switchEthereumChain", [
          { chainId: "0x" + ACTIVE_CHAIN.id.toString(16) },
        ]);
      } catch {
        // try add then switch (Base mainnet)
        await (provider as any).send("wallet_addEthereumChain", [{
          chainId: "0x" + ACTIVE_CHAIN.id.toString(16),
          chainName: "Base",
          rpcUrls: ["https://mainnet.base.org"],
          nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
          blockExplorerUrls: ["https://basescan.org"],
        }]);
      }
    }
  }

  async function getSigner() {
    const provider = await getProvider();
    await ensureBaseChain(provider);
    return provider.getSigner();
  }

  // ===== initial reads =====
  useEffect(() => {
    (async () => {
      if (!isConnected) return;
      try {
        const signer = await getSigner();
        const presale = new ethers.Contract(PRESALE_ADDRESS, SAAD_PRESALE_USD_ABI, signer);

        // phase + price
        const p: bigint = await presale.currentPhase();
        setPhase(Number(p));
        const pr6: bigint = await presale.pricePerTokenUSDT(p);
        setPriceUSDT6(pr6);

        // phase caps/sold/deadline/etc.
        const info = await presale.phases(p);
        setPhaseCap(info.cap);
        setPhaseSold(info.sold);

        // claim window constants (global)
        try {
          const cs: bigint = await presale.claimStart();
          const cliff: bigint = await presale.cliffSeconds();
          const dur: bigint = await presale.vestingDuration();
          setClaimStart(Number(cs));
          setCliffSeconds(Number(cliff));
          setVestingDuration(Number(dur));
        } catch {
          // still not ended; leave defaults
        }

        // USDT token meta
        const erc20 = new ethers.Contract(USDT_ADDRESS, ERC20_MIN_ABI, signer);
        const d: number = await erc20.decimals();
        setUsdtDecimals(d);

        const bal: bigint = await erc20.balanceOf(address!);
        setUsdtBalance(bal);

        const a: bigint = await erc20.allowance(address!, PRESALE_ADDRESS);
        setUsdtAllowance(a);

        // my vesting info (if presale ended)
        await refreshMyVesting(signer);

      } catch (e) {
        console.warn("Init reads failed:", e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address]);

  async function refreshMyVesting(signer?: ethers.Signer) {
    if (!isConnected || !address) return;
    try {
      const s = signer || (await getSigner());
      const presale = new ethers.Contract(PRESALE_ADDRESS, SAAD_PRESALE_USD_ABI, s);
      const vi = await presale.vestingInfo(address);

      setClaimedByMe(vi.alreadyClaimed);
      setUnlockedByMe(vi.unlocked);
      setClaimableByMe(vi.claimable);

      const now = Math.floor(Date.now() / 1000);
      const unlockStart = Number(vi._claimStart) + Number(vi._cliff);
      if (now < unlockStart) {
        setNextUnlockIn(formatETA(unlockStart - now));
      } else if (Number(vi._duration) > 0) {
        // next minute approximation within linear vesting
        const perSec = Number(vi.total) / Math.max(1, Number(vi._duration));
        const remaining = Math.max(0, Number(vi.total) - Number(vi.alreadyClaimed));
        const secsLeft = Math.ceil(remaining / Math.max(1e-9, perSec));
        setNextUnlockIn(formatETA(secsLeft));
      } else {
        setNextUnlockIn("—");
      }
    } catch (e) {
      // presale may not be ended yet
      setNextUnlockIn("—");
    }
  }

  function formatETA(secs: number) {
    const d = Math.floor(secs / 86400);
    const h = Math.floor((secs % 86400) / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m`;
    if (m > 0) return `${m}m ${s}s`;
    return `${s}s`;
  }

  // ===== SMART PURCHASE ACTIONS =====
  async function handleSmartBuyETH() {
    if (!isConnected) return alert("Connect wallet first.");
    try {
      setLoading(true);
      setTxStatus("Preparing ETH purchase…");

      const tokensWanted = parseFloat(desiredSq8 || "0");
      if (!tokensWanted || tokensWanted <= 0) throw new Error("Enter SQ8 amount > 0");

      const signer = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, SAAD_PRESALE_USD_ABI, signer);

      // USD cost in 6 dp
      const usd6 = BigInt(Math.ceil(tokensWanted * Number(priceUSDT6)));

      // USD -> ETH via oracle
      const ethUsd6: bigint = await presale.getEthUsd6();        // $ per 1 ETH (6dp)
      if (!ethUsd6 || ethUsd6 === 0n) throw new Error("Oracle price invalid.");
      let ethWei = (usd6 * 1_000_000_000_000_000_000n) / ethUsd6;
      ethWei = (ethWei * 102n) / 100n; // +2% buffer

      try { await presale.buyWithETH.staticCall({ value: ethWei }); } catch { /* ignore */ }
      const tx = await presale.buyWithETH({ value: ethWei });
      await tx.wait();

      setTxStatus("✅ ETH purchase successful!");
      await refreshAfterPurchase();
    } catch (e: any) {
      setTxStatus(`❌ Failed: ${e?.reason || e?.message || String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleSmartBuyUSDT() {
    if (!isConnected) return alert("Connect wallet first.");
    try {
      setLoading(true);
      setTxStatus("Preparing USDT purchase…");

      const tokensWanted = parseFloat(desiredSq8 || "0");
      if (!tokensWanted || tokensWanted <= 0) throw new Error("Enter SQ8 amount > 0");

      const signer = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, SAAD_PRESALE_USD_ABI, signer);
      const erc20 = new ethers.Contract(USDT_ADDRESS, ERC20_MIN_ABI, signer);

      const usd6 = BigInt(Math.ceil(tokensWanted * Number(priceUSDT6)));

      const a: bigint = await erc20.allowance(address!, PRESALE_ADDRESS);
      if (a < usd6) {
        setTxStatus("Approving USDT…");
        const txA = await erc20.approve(PRESALE_ADDRESS, usd6);
        await txA.wait();
      }

      setTxStatus("Buying with USDT…");
      try { await presale.buyWithUSDT.staticCall(usd6); } catch { /* ignore */ }
      const tx = await presale.buyWithUSDT(usd6, { gasLimit: 300000n });
      await tx.wait();

      setTxStatus("✅ USDT purchase successful!");
      await refreshAfterPurchase();
    } catch (e: any) {
      setTxStatus(`❌ Failed: ${e?.reason || e?.message || String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function refreshAfterPurchase() {
    try {
      const signer = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, SAAD_PRESALE_USD_ABI, signer);
      const p = await presale.currentPhase();
      const info = await presale.phases(p);
      setPhase(Number(p));
      setPhaseCap(info.cap);
      setPhaseSold(info.sold);
      await refreshMyVesting(signer);
      // refresh USDT allowance/balance
      const erc20 = new ethers.Contract(USDT_ADDRESS, ERC20_MIN_ABI, signer);
      setUsdtBalance(await erc20.balanceOf(address!));
      setUsdtAllowance(await erc20.allowance(address!, PRESALE_ADDRESS));
    } catch (e) {
      console.warn("refreshAfterPurchase failed:", e);
    }
  }

  // ===== Manual ETH/USDT (kept intact) =====
  async function handleBuyETH() {
    if (!isConnected) return alert("Connect wallet first.");
    try {
      setLoading(true);
      setTxStatus("Sending ETH transaction…");
      const signer = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, SAAD_PRESALE_USD_ABI, signer);
      const value = ethers.parseEther(ethAmount || "0.001");
      try { await presale.buyWithETH.staticCall({ value }); } catch {}
      const tx = await presale.buyWithETH({ value });
      await tx.wait();
      setTxStatus("✅ ETH purchase successful!");
      await refreshAfterPurchase();
    } catch (e: any) {
      setTxStatus(`❌ Failed: ${e?.reason || e?.message || String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleApproveUSDT() {
    if (!isConnected) return alert("Connect wallet first.");
    try {
      setLoading(true);
      setTxStatus("Approving USDT…");
      const signer = await getSigner();
      const erc20 = new ethers.Contract(USDT_ADDRESS, ERC20_MIN_ABI, signer);
      const amount = ethers.parseUnits(usdtAmount || "0", usdtDecimals);
      const tx = await erc20.approve(PRESALE_ADDRESS, amount);
      await tx.wait();
      setUsdtAllowance(await erc20.allowance(address!, PRESALE_ADDRESS));
      setTxStatus("✅ USDT approved!");
    } catch (e: any) {
      setTxStatus(`❌ Approve failed: ${e?.reason || e?.message || String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleBuyUSDT() {
    if (!isConnected) return alert("Connect wallet first.");
    try {
      setLoading(true);
      setTxStatus("Buying with USDT…");
      const signer = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, SAAD_PRESALE_USD_ABI, signer);
      const amount = ethers.parseUnits(usdtAmount || "0", usdtDecimals);
      try { await presale.buyWithUSDT.staticCall(amount); } catch {}
      const tx = await presale.buyWithUSDT(amount, { gasLimit: 300000n });
      await tx.wait();
      setTxStatus("✅ USDT purchase successful!");
      await refreshAfterPurchase();
    } catch (e: any) {
      setTxStatus(`❌ USDT buy failed: ${e?.reason || e?.message || String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  // ===== Claim =====
  async function handleClaim() {
    if (!isConnected) return alert("Connect wallet first.");
    try {
      setLoading(true);
      setTxStatus("Claiming…");
      const signer = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, SAAD_PRESALE_USD_ABI, signer);
      const tx = await presale.claim();
      await tx.wait();
      setTxStatus("✅ Claimed!");
      await refreshMyVesting(signer);
    } catch (e: any) {
      setTxStatus(`❌ Claim failed: ${e?.reason || e?.message || String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  // ===== Onramps (unchanged) =====
  function openTransak() {
    if (!address) return alert("Connect wallet first.");
    if (!TRANSAK_API_KEY) {
      alert("Set TRANSAK_API_KEY in src/constants.ts");
      return;
    }
    const params = new URLSearchParams({
      apiKey: TRANSAK_API_KEY,
      environment: "PRODUCTION",           // set to STAGING only with sandbox keys
      walletAddress: address,
      defaultCryptoCurrency: "ETH",
      cryptoCurrencyCode: "ETH",
      disableWalletAddressForm: "true",
    });
    const url = `${TRANSAK_ENV_URL}?${params.toString()}`;
    window.open(url, "_blank", "width=420,height=720");
  }

  function openCoinbaseCheckout() {
    if (!COINBASE_CHECKOUT_ID) {
      alert("Set COINBASE_CHECKOUT_ID in src/constants.ts");
      return;
    }
    window.open(`https://commerce.coinbase.com/checkout/${COINBASE_CHECKOUT_ID}`, "_blank");
  }

  // ===== UI =====
  return (
    <div style={{ minHeight: "100vh", padding: 24, color: "#fff", background: "#0d0d0d", fontFamily: "Inter, system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 32, marginBottom: 6 }}>SAADverse Presale</h1>

      <p style={{ marginTop: 0, opacity: 0.85 }}>
        Chain: <b>{ACTIVE_CHAIN.name}</b> — Wallet: {isConnected ? <span style={{ color: "#39ff14" }}>{address}</span> : "Not connected"}
      </p>

      {isConnected ? (
        <button onClick={() => disconnect()} style={{ padding: 10, marginBottom: 16, background: "#ef4444", borderRadius: 8 }}>
          Disconnect
        </button>
      ) : (
        <button onClick={() => connect()} style={{ padding: 10, marginBottom: 16, background: "#3b82f6", borderRadius: 8 }}>
          Connect Wallet
        </button>
      )}

      {/* Phase + USD Price */}
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 16 }}>
          Current Phase: <b>{phase + 1}</b> &nbsp; | &nbsp; Price: <b>${toFixed(Number(priceUSDT6) / 1_000_000, 4)}</b> / SQ8
        </div>
      </div>

      {/* Phase progress */}
      <div style={{ border: "1px solid #555", borderRadius: 10, padding: 12, maxWidth: 560, marginBottom: 16 }}>
        <div style={{ marginBottom: 6, fontSize: 14, opacity: 0.9 }}>
          Phase {phase + 1} Progress — Sold: {fmt(phaseSold, 18).toLocaleString(undefined, { maximumFractionDigits: 0 })} /{" "}
          {fmt(phaseCap, 18).toLocaleString(undefined, { maximumFractionDigits: 0 })} SQ8 ({progressPct.toFixed(2)}%)
        </div>
        <div style={{ width: "100%", height: 10, background: "#1f2937", borderRadius: 999, overflow: "hidden" }}>
          <div style={{ width: `${progressPct}%`, height: "100%", background: "#22c55e" }} />
        </div>
      </div>

      {/* === SMART PURCHASE: Buy by SQ8 amount === */}
      <div style={{ border: "1px solid #a78bfa", borderRadius: 12, padding: 16, maxWidth: 560, width: "100%", marginBottom: 16 }}>
        <h3>Buy by SQ8 Amount</h3>
        <p style={{ fontSize: 12, opacity: 0.8, marginTop: 0 }}>
          Current price: <b>${(Number(priceUSDT6) / 1_000_000).toFixed(4)}</b> per SQ8
        </p>

        <input
          value={desiredSq8}
          onChange={(e) => setDesiredSq8(e.target.value)}
          placeholder="Enter SQ8 amount (e.g., 100000)"
          style={{ width: "100%", padding: 10, borderRadius: 8, margin: "8px 0" }}
        />

        {/* USD preview */}
        <p style={{ fontSize: 12, opacity: 0.85, margin: "6px 0" }}>
          ≈ ${(Number(desiredSq8 || "0") * (Number(priceUSDT6) / 1_000_000)).toLocaleString(undefined, { maximumFractionDigits: 2 })} USD
        </p>

        <div style={{ display: "grid", gap: 8 }}>
          <button disabled={loading} onClick={handleSmartBuyETH} style={{ padding: 12, background: "#16a34a", borderRadius: 8, width: "100%" }}>
            {loading ? "Processing…" : "Use ETH"}
          </button>
          <button disabled={loading} onClick={handleSmartBuyUSDT} style={{ padding: 12, background: "#2563eb", borderRadius: 8, width: "100%" }}>
            {loading ? "Processing…" : "Use USDT"}
          </button>
        </div>

        <p style={{ fontSize: 12, opacity: 0.75, marginTop: 8 }}>
          ETH flow auto-converts USD→ETH at the on-chain oracle rate (with a small buffer). USDT uses exact USD (6dp).
        </p>
      </div>

      {/* --- Manual ETH BUY --- */}
      <div style={{ border: "1px solid #39ff14", borderRadius: 12, padding: 16, maxWidth: 560, width: "100%", marginBottom: 16 }}>
        <h3>Buy with ETH</h3>
        <input
          value={ethAmount}
          onChange={(e) => setEthAmount(e.target.value)}
          placeholder="Spend amount in ETH (e.g., 0.01)"
          style={{ width: "100%", padding: 10, borderRadius: 8, margin: "8px 0" }}
        />
        <button disabled={loading} onClick={handleBuyETH} style={{ padding: 12, background: "#16a34a", borderRadius: 8, width: "100%" }}>
          {loading ? "Processing…" : "Buy with ETH"}
        </button>
      </div>

      {/* --- Manual USDT BUY --- */}
      <div style={{ border: "1px solid #60a5fa", borderRadius: 12, padding: 16, maxWidth: 560, width: "100%", marginBottom: 16 }}>
        <h3>Buy with USDT</h3>
        <p style={{ opacity: 0.8, fontSize: 12 }}>
          Balance: {fmt(usdtBalance, usdtDecimals).toLocaleString()} — Allowance: {fmt(usdtAllowance, usdtDecimals).toLocaleString()}
        </p>
        <input
          value={usdtAmount}
          onChange={(e) => setUsdtAmount(e.target.value)}
          placeholder="Spend amount in USDT (e.g., 100)"
          style={{ width: "100%", padding: 10, borderRadius: 8, margin: "8px 0" }}
        />
        {needsApprove ? (
          <button disabled={loading} onClick={handleApproveUSDT} style={{ padding: 12, background: "#3b82f6", borderRadius: 8, width: "100%", marginBottom: 8 }}>
            {loading ? "Approving…" : "Approve USDT"}
          </button>
        ) : (
          <button disabled={loading} onClick={handleBuyUSDT} style={{ padding: 12, background: "#2563eb", borderRadius: 8, width: "100%", marginBottom: 8 }}>
            {loading ? "Processing…" : "Buy with USDT"}
          </button>
        )}
        <p style={{ fontSize: 12, opacity: 0.8 }}>
          Price shown in USD; USDT is used directly at 6 decimals.
        </p>
      </div>

      {/* --- CLAIM CARD --- */}
      <div style={{ border: "1px solid #94a3b8", borderRadius: 12, padding: 16, maxWidth: 560, width: "100%", marginBottom: 16 }}>
        <h3>Claim</h3>
        <p style={{ margin: 0, opacity: 0.9, fontSize: 14 }}>
          Claimed: <b>{fmt(claimedByMe, 18).toLocaleString(undefined, { maximumFractionDigits: 0 })}</b> SQ8
          &nbsp; | &nbsp; Unlocked: <b>{fmt(unlockedByMe, 18).toLocaleString(undefined, { maximumFractionDigits: 0 })}</b> SQ8
          &nbsp; | &nbsp; Claimable now: <b>{fmt(claimableByMe, 18).toLocaleString(undefined, { maximumFractionDigits: 0 })}</b> SQ8
        </p>
        <p style={{ margin: "6px 0 10px", opacity: 0.8, fontSize: 12 }}>
          Next unlock in: <b>{nextUnlockIn}</b>
        </p>
        <button disabled={loading} onClick={handleClaim} style={{ padding: 12, background: "#22c55e", borderRadius: 8 }}>
          {loading ? "Processing…" : "Claim"}
        </button>
      </div>

      {/* --- ONRAMPS --- */}
      <div style={{ border: "1px solid #f59e0b", borderRadius: 12, padding: 16, maxWidth: 560, width: "100%" }}>
        <h3>Buy with Card / Apple Pay / PayPal</h3>
        <button onClick={openTransak} style={{ padding: 12, background: "#f59e0b", color: "#000", borderRadius: 8, width: "100%", marginBottom: 8 }}>
          Open Transak (Card / Apple Pay)
        </button>
        <button onClick={openCoinbaseCheckout} style={{ padding: 12, background: "#fff", color: "#000", borderRadius: 8, width: "100%" }}>
          Open Coinbase Commerce
        </button>
        <p style={{ fontSize: 12, opacity: 0.75, marginTop: 8 }}>
          Configure <code>TRANSAK_API_KEY</code> and <code>COINBASE_CHECKOUT_ID</code> in <code>src/constants.ts</code>.
        </p>
      </div>

      {txStatus && <p style={{ marginTop: 12 }}>{txStatus}</p>}

      <footer style={{ marginTop: 32, opacity: 0.6, fontSize: 12 }}>© 2025 SAADverse — USD-pegged mechanics</footer>
    </div>
  );
}
