// src/App.tsx
import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { InjectedConnector } from "wagmi/connectors/injected";

import {
  ACTIVE_CHAIN,
  PRESALE_ADDRESS,
  USDT_ADDRESS,
  SAAD_ADDRESS,
  TRANSAK_ENV_URL,
  TRANSAK_API_KEY,
  COINBASE_CHECKOUT_ID,
} from "./constants";

import {
  SAAD_PRESALE_ABI,        // legacy presale abi (if any)
  SAAD_PRESALE_USD_ABI,    // USD-pegged presale (Pro)
  ERC20_MIN_ABI,
} from "./abi";

// ---------- utils ----------
const fmt = (n: bigint, d = 18) => Number(n) / Number(10n ** BigInt(d));
const nowSec = () => Math.floor(Date.now() / 1000);

// USD display fallback (if reading from contract fails)
const USD_PRICES = [0.0016, 0.0018, 0.0020];

export default function App() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect({ connector: new InjectedConnector() });
  const { disconnect } = useDisconnect();

  const [loading, setLoading] = useState(false);
  const [txStatus, setTxStatus] = useState("");

  // ---- contract shape / pricing ----
  const [usdMode, setUsdMode] = useState(false);
  const [phase, setPhase] = useState<number>(0);
  const [usdPrice, setUsdPrice] = useState<number>(USD_PRICES[0]);     // shown in UI only
  const [priceUSDT6, setPriceUSDT6] = useState<bigint>(1600n);          // on-chain price (6 dp)
  const [paused, setPaused] = useState<boolean>(false);
  const [presaleEnded, setPresaleEnded] = useState<boolean>(false);

  // ---- balances / allowances (USDT) ----
  const [usdtDecimals, setUsdtDecimals] = useState<number>(6);
  const [usdtBalance, setUsdtBalance] = useState<bigint>(0n);
  const [allowance, setAllowance] = useState<bigint>(0n);

  // ---- existing cards (manual ETH/USDT spend) ----
  const [ethAmount, setEthAmount] = useState<string>("");
  const [usdtAmount, setUsdtAmount] = useState<string>("");

  // ---- SMART PURCHASE (buy by SQ8 amount) ----
  const [desiredSq8, setDesiredSq8] = useState<string>("");

  // ---- progress / totals ----
  const [totalPurchased, setTotalPurchased] = useState<bigint>(0n);
  const [phaseCap, setPhaseCap] = useState<bigint>(0n);
  const [phaseSold, setPhaseSold] = useState<bigint>(0n);
  const progressPct = useMemo(() => {
    if (phaseCap === 0n) return 0;
    const r = (Number(phaseSold) / Number(phaseCap)) * 100;
    return Math.max(0, Math.min(100, r));
  }, [phaseSold, phaseCap]);

  // ---- vesting / claim ----
  const [claimable, setClaimable] = useState<bigint>(0n);
  const [unlocked, setUnlocked] = useState<bigint>(0n);
  const [alreadyClaimed, setAlreadyClaimed] = useState<bigint>(0n);
  const [claimStart, setClaimStart] = useState<number>(0);
  const [cliffSeconds, setCliffSeconds] = useState<number>(0);
  const [vestingDuration, setVestingDuration] = useState<number>(0);

  // countdown
  const [now, setNow] = useState<number>(nowSec());
  useEffect(() => {
    const t = setInterval(() => setNow(nowSec()), 1000);
    return () => clearInterval(t);
  }, []);
  const secondsToNextUnlock = useMemo(() => {
    if (!claimStart || !cliffSeconds) return 0;
    const cliffAt = claimStart + cliffSeconds;
    return Math.max(0, cliffAt - now);
  }, [claimStart, cliffSeconds, now]);

  const needsApprove = useMemo(() => {
    try {
      const want = ethers.parseUnits(usdtAmount || "0", usdtDecimals);
      return allowance < want;
    } catch {
      return true;
    }
  }, [allowance, usdtAmount, usdtDecimals]);

  // ---------- helpers ----------
  async function getSigner() {
    if (!(window as any).ethereum) throw new Error("No injected wallet");
    const provider = new ethers.BrowserProvider((window as any).ethereum);
    const net = await provider.getNetwork();
    if (net.chainId !== BigInt(ACTIVE_CHAIN.id)) {
      throw new Error(`Wrong network. Please switch to ${ACTIVE_CHAIN.name}.`);
    }
    return provider.getSigner();
  }

  async function getPresale(signer: ethers.Signer) {
    // We try USD ABI first; if it fails, we’ll fall back to legacy reads elsewhere.
    return new ethers.Contract(PRESALE_ADDRESS, SAAD_PRESALE_USD_ABI, signer);
  }

  // ---------- initial load ----------
  useEffect(() => {
    (async () => {
      if (!isConnected || !address) return;
      try {
        const signer = await getSigner();
        const presale = await getPresale(signer);

        // Detect USD mode, phase, price
        try {
          const p: bigint = await presale.currentPhase();
          setPhase(Number(p));
          const pr6: bigint = await presale.pricePerTokenUSDT(p);
          setPriceUSDT6(pr6);
          setUsdPrice(Number(pr6) / 1_000_000);
          setUsdMode(true);
        } catch (e) {
          // fallback for non-USD contract
          setUsdMode(false);
          setUsdPrice(USD_PRICES[0]);
          setPriceUSDT6(BigInt(Math.round(USD_PRICES[0] * 1_000_000)));
        }

        // paused / ended
        try {
          const pa: boolean = await presale.paused();
          setPaused(pa);
        } catch {}
        try {
          const pe: boolean = await presale.presaleEnded();
          setPresaleEnded(pe);
        } catch {}

        // progress: current phase cap/sold + total
        try {
          const ph = await presale.phases(phase);
          setPhaseCap(ph.cap ?? 0n);
          setPhaseSold(ph.sold ?? 0n);
        } catch {}
        try {
          const tot: bigint = await presale.totalPurchased?.() ?? 0n;
          setTotalPurchased(tot);
        } catch {}

        // USDT token info
        try {
          const erc20 = new ethers.Contract(USDT_ADDRESS, ERC20_MIN_ABI, signer);
          const d: number = await erc20.decimals();
          setUsdtDecimals(d);
          const bal: bigint = await erc20.balanceOf(address);
          setUsdtBalance(bal);
          const a: bigint = await erc20.allowance(address, PRESALE_ADDRESS);
          setAllowance(a);
        } catch (e) {
          console.warn("USDT probe skipped:", e);
        }

        // vesting read (works after presale ended)
        try {
          const vi = await presale.vestingInfo(address);
          // vestingInfo returns: total, alreadyClaimed, unlocked, claimable, _claimStart, _cliff, _duration
          setAlreadyClaimed(vi.alreadyClaimed ?? 0n);
          setUnlocked(vi.unlocked ?? 0n);
          setClaimable(vi.claimable ?? 0n);
          setClaimStart(Number(vi._claimStart ?? 0));
          setCliffSeconds(Number(vi._cliff ?? 0));
          setVestingDuration(Number(vi._duration ?? 0));
        } catch (e) {
          // ignore until presale end
        }
      } catch (e) {
        console.warn("Init skipped:", e);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, address, phase]);

  // ---------- manual ETH buy ----------
  async function handleBuyETH() {
    if (!isConnected) return alert("Connect wallet first.");
    try {
      setLoading(true);
      setTxStatus("Sending ETH transaction…");
      const signer = await getSigner();
      const presale = await getPresale(signer);
      const value = ethers.parseEther(ethAmount || "0");

      try { await presale.buyWithETH.staticCall({ value }); } catch {}
      const tx = await presale.buyWithETH({ value });
      await tx.wait();
      setTxStatus("✅ ETH purchase successful!");
    } catch (err: any) {
      setTxStatus(`❌ Failed: ${err?.reason || err?.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  // ---------- manual USDT approve/buy ----------
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

      const newAllowance: bigint = await erc20.allowance(address!, PRESALE_ADDRESS);
      setAllowance(newAllowance);
      setTxStatus("✅ USDT approved!");
    } catch (err: any) {
      setTxStatus(`❌ Approve failed: ${err?.reason || err?.message || String(err)}`);
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
      const presale = await getPresale(signer);
      const amount = ethers.parseUnits(usdtAmount || "0", usdtDecimals);

      try { await presale.buyWithUSDT.staticCall(amount); } catch {}
      const tx = await presale.buyWithUSDT(amount, { gasLimit: 300000n });
      await tx.wait();

      setTxStatus("✅ USDT purchase successful!");
    } catch (err: any) {
      setTxStatus(`❌ USDT buy failed: ${err?.reason || err?.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  // ---------- SMART PURCHASE (by SQ8 amount) ----------
  async function handleSmartBuyETH() {
    if (!isConnected) return alert("Connect wallet first.");
    try {
      setLoading(true);
      setTxStatus("Preparing ETH purchase…");

      const tokensWanted = parseFloat(desiredSq8 || "0");
      if (!tokensWanted || tokensWanted <= 0) throw new Error("Enter SQ8 amount > 0");

      const signer = await getSigner();
      const presale = await getPresale(signer);

      // USD cost (6 dp) = tokensWanted * priceUSDT6
      const usd6 = BigInt(Math.ceil(tokensWanted * Number(priceUSDT6)));

      // Convert USD→ETH using on-chain oracle
      const ethUsd6: bigint = await presale.getEthUsd6();
      let ethWei = (usd6 * 1_000_000_000_000_000_000n) / ethUsd6;
      ethWei = (ethWei * 102n) / 100n; // +2% buffer

      try { await presale.buyWithETH.staticCall({ value: ethWei }); } catch {}
      const tx = await presale.buyWithETH({ value: ethWei });
      await tx.wait();

      setTxStatus("✅ ETH purchase successful!");
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
      const presale = await getPresale(signer);
      const erc20 = new ethers.Contract(USDT_ADDRESS, ERC20_MIN_ABI, signer);

      // USD (6 dp)
      const usd6 = BigInt(Math.ceil(tokensWanted * Number(priceUSDT6)));

      // approve if needed
      const a: bigint = await erc20.allowance(address!, PRESALE_ADDRESS);
      if (a < usd6) {
        setTxStatus("Approving USDT…");
        const txA = await erc20.approve(PRESALE_ADDRESS, usd6);
        await txA.wait();
      }

      // buy
      setTxStatus("Buying with USDT…");
      try { await presale.buyWithUSDT.staticCall(usd6); } catch {}
      const tx = await presale.buyWithUSDT(usd6, { gasLimit: 300000n });
      await tx.wait();

      setTxStatus("✅ USDT purchase successful!");
    } catch (e: any) {
      setTxStatus(`❌ Failed: ${e?.reason || e?.message || String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  // ---------- claim ----------
  async function handleClaim() {
    if (!isConnected) return alert("Connect wallet first.");
    try {
      setLoading(true);
      setTxStatus("Claiming…");
      const signer = await getSigner();
      const presale = await getPresale(signer);

      const tx = await presale.claim();
      await tx.wait();

      setTxStatus("✅ Claimed!");
      // refresh vesting info after claim
      try {
        const vi = await presale.vestingInfo(address);
        setAlreadyClaimed(vi.alreadyClaimed ?? 0n);
        setUnlocked(vi.unlocked ?? 0n);
        setClaimable(vi.claimable ?? 0n);
      } catch {}
    } catch (e: any) {
      setTxStatus(`❌ Claim failed: ${e?.reason || e?.message || String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  // ---------- onramp ----------
  function openTransak() {
    if (!address) return alert("Connect wallet first.");
    if (!TRANSAK_API_KEY) {
      alert("Set TRANSAK_API_KEY in src/constants.ts");
      return;
    }
    const params = new URLSearchParams({
      apiKey: TRANSAK_API_KEY,
      environment: "PRODUCTION", // switch if using sandbox
      walletAddress: address,
      defaultCryptoCurrency: "ETH",
      cryptoCurrencyCode: "ETH",
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

  // ---------- admin ----------
  async function adminCall(fn: "pause" | "resume" | "advancePhase") {
    try {
      const signer = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, SAAD_PRESALE_USD_ABI, signer);
      const tx = await presale[fn]();
      await tx.wait();
      alert(`${fn} success`);
      if (fn === "advancePhase") {
        const p: bigint = await presale.currentPhase();
        const pr6: bigint = await presale.pricePerTokenUSDT(p);
        setPhase(Number(p));
        setPriceUSDT6(pr6);
        setUsdPrice(Number(pr6) / 1_000_000);
      }
      if (fn === "pause") setPaused(true);
      if (fn === "resume") setPaused(false);
    } catch (e: any) {
      alert(e?.reason || e?.message || String(e));
    }
  }

  // ---------- render ----------
  return (
    <div style={{ minHeight: "100vh", padding: 24, color: "#fff", background: "#0d0d0d", fontFamily: "Inter, system-ui, sans-serif" }}>
      <h1 style={{ fontSize: 36, marginBottom: 8 }}>SAADverse Presale</h1>

      <p style={{ opacity: 0.85, marginTop: 0, marginBottom: 8 }}>
        Chain: <b>{ACTIVE_CHAIN.name}</b> — Wallet: {isConnected ? <span style={{ color: "#39ff14" }}>{address}</span> : "Not connected"}
      </p>

      {isConnected ? (
        <button onClick={() => disconnect()} style={{ padding: 10, marginBottom: 20, background: "#ef4444", borderRadius: 8 }}>
          Disconnect
        </button>
      ) : (
        <button onClick={() => connect()} style={{ padding: 10, marginBottom: 20, background: "#3b82f6", borderRadius: 8 }}>
          Connect Wallet
        </button>
      )}

      {/* Top line (phase + price + paused) */}
      <div style={{ marginBottom: 16 }}>
        <span>Phase: <b>{phase + 1}</b></span>
        <span style={{ marginLeft: 12 }}>Price: <b>${usdPrice.toFixed(4)}</b> / SQ8</span>
        <span style={{ marginLeft: 12 }}>Status: {presaleEnded ? "Ended" : paused ? "Paused" : "Live"}</span>
      </div>

      {/* --- SMART PURCHASE --- */}
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
          ETH flow converts USD→ETH using the on-chain oracle (adds a small buffer). USDT uses exact USD (6dp).
        </p>
      </div>

      {/* --- ETH BUY (manual amount) --- */}
      <div style={{ border: "1px solid #39ff14", borderRadius: 12, padding: 16, maxWidth: 560, width: "100%", marginBottom: 16 }}>
        <h3>Buy with ETH (manual)</h3>
        <input
          value={ethAmount}
          onChange={(e) => setEthAmount(e.target.value)}
          placeholder="ETH amount (e.g., 0.01)"
          style={{ width: "100%", padding: 10, borderRadius: 8, margin: "8px 0" }}
        />
        <button disabled={loading} onClick={handleBuyETH} style={{ padding: 12, background: "#16a34a", borderRadius: 8, width: "100%" }}>
          {loading ? "Processing…" : "Buy with ETH"}
        </button>
      </div>

      {/* --- USDT BUY (manual) --- */}
      <div style={{ border: "1px solid #60a5fa", borderRadius: 12, padding: 16, maxWidth: 560, width: "100%", marginBottom: 16 }}>
        <h3>Buy with USDT (manual)</h3>
        <p style={{ opacity: 0.8, fontSize: 12 }}>
          Balance: {fmt(usdtBalance, usdtDecimals).toLocaleString()} USDT — Allowance: {fmt(allowance, usdtDecimals).toLocaleString()} USDT
        </p>
        <input
          value={usdtAmount}
          onChange={(e) => setUsdtAmount(e.target.value)}
          placeholder="USDT amount (e.g., 100)"
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
      </div>

      {/* --- Progress --- */}
      <div style={{ border: "1px solid #888", borderRadius: 12, padding: 16, maxWidth: 560, width: "100%", marginBottom: 16 }}>
        <h3>Phase Progress</h3>
        <div style={{ height: 12, background: "#222", borderRadius: 8, overflow: "hidden", margin: "8px 0" }}>
          <div style={{ width: `${progressPct}%`, height: "100%", background: "#22c55e" }} />
        </div>
        <p style={{ fontSize: 12, opacity: 0.8, margin: 0 }}>
          Phase {phase + 1}: {fmt(phaseSold, 18).toLocaleString()} / {fmt(phaseCap, 18).toLocaleString()} SQ8
        </p>
        <p style={{ fontSize: 12, opacity: 0.8, margin: 0 }}>
          Total purchased: {fmt(totalPurchased, 18).toLocaleString()} SQ8
        </p>
      </div>

      {/* --- Claim --- */}
      <div style={{ border: "1px solid #f472b6", borderRadius: 12, padding: 16, maxWidth: 560, width: "100%", marginBottom: 16 }}>
        <h3>Claim</h3>
        {presaleEnded ? (
          <>
            <p style={{ margin: 0 }}>Claimable: <b>{fmt(claimable, 18).toLocaleString()}</b> SQ8</p>
            <p style={{ margin: 0 }}>Unlocked (total): {fmt(unlocked, 18).toLocaleString()} SQ8</p>
            <p style={{ margin: 0, marginBottom: 8 }}>Already claimed: {fmt(alreadyClaimed, 18).toLocaleString()} SQ8</p>
            {secondsToNextUnlock > 0 ? (
              <p style={{ fontSize: 12, opacity: 0.8 }}>
                Next unlock in ~{Math.floor(secondsToNextUnlock / 60)}m {secondsToNextUnlock % 60}s
              </p>
            ) : (
              <p style={{ fontSize: 12, opacity: 0.8 }}>Vesting in progress.</p>
            )}
            <button disabled={loading || claimable === 0n} onClick={handleClaim} style={{ padding: 12, background: "#f472b6", borderRadius: 8, width: "100%" }}>
              {loading ? "Processing…" : "Claim"}
            </button>
          </>
        ) : (
          <p style={{ fontSize: 12, opacity: 0.8 }}>Claiming will be available after presale ends and vesting starts.</p>
        )}
      </div>

      {/* --- Onramps --- */}
      <div style={{ border: "1px solid #f59e0b", borderRadius: 12, padding: 16, maxWidth: 560, width: "100%", marginBottom: 16 }}>
        <h3>Buy with Card / Apple Pay / PayPal</h3>
        <button onClick={openTransak} style={{ padding: 12, background: "#f59e0b", color: "#000", borderRadius: 8, width: "100%", marginBottom: 8 }}>
          Open Transak (Card / Apple Pay)
        </button>
        <button onClick={openCoinbaseCheckout} style={{ padding: 12, background: "#fff", color: "#000", borderRadius: 8, width: "100%" }}>
          Open Coinbase Commerce
        </button>
      </div>

      {/* --- Admin --- */}
      <div style={{ border: "1px solid #bbb", borderRadius: 12, padding: 16, maxWidth: 560, width: "100%" }}>
        <h3>Admin Panel</h3>
        <div style={{ display: "grid", gap: 8 }}>
          <button onClick={() => adminCall("pause")}>Pause</button>
          <button onClick={() => adminCall("resume")}>Resume</button>
          <button onClick={() => adminCall("advancePhase")}>Advance Phase</button>
        </div>
      </div>

      {txStatus && <p style={{ marginTop: 12 }}>{txStatus}</p>}

      <footer style={{ marginTop: 32, opacity: 0.6, fontSize: 12 }}>© 2025 SAADverse — Presale</footer>
    </div>
  );
}
