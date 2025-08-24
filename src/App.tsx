


// src/App.tsx
import React, { useEffect, useMemo, useState } from "react";
import { useAccount, useConnect, useDisconnect } from "wagmi";
import { InjectedConnector } from "wagmi/connectors/injected";
import { ethers } from "ethers";

import {
  ACTIVE_CHAIN,
  PRESALE_ADDRESS,
  USDT_ADDRESS,
  TRANSAK_ENV_URL,
  TRANSAK_API_KEY,
  COINBASE_CHECKOUT_ID,
} from "./constants";

import { SAAD_PRESALE_USD_PRO_ABI, ERC20_MIN_ABI } from "./abi";

const fmt = (n: bigint, d = 18) => Number(n) / Number(10n ** BigInt(d));

export default function App() {
  const { address, isConnected } = useAccount();
  const { connect } = useConnect({ connector: new InjectedConnector() });
  const { disconnect } = useDisconnect();

  // Display state
  const [phase, setPhase] = useState<number>(0);
  const [usdPrice, setUsdPrice] = useState<number>(0.0016); // fallback
  const [presaleEnded, setPresaleEnded] = useState<boolean>(false);
  const [whitelistRequired, setWhitelistRequired] = useState<boolean>(false);

  // ETH
  const [ethAmount, setEthAmount] = useState("0.001");
  const [loading, setLoading] = useState(false);
  const [txStatus, setTxStatus] = useState<string>("");

  // USDT
  const [usdtAmount, setUsdtAmount] = useState("100");
  const [usdtDecimals, setUsdtDecimals] = useState<number>(6);
  const [allowance, setAllowance] = useState<bigint>(0n);
  const [usdtBalance, setUsdtBalance] = useState<bigint>(0n);

  // Vesting/claim
  const [total, setTotal] = useState<bigint>(0n);
  const [alreadyClaimed, setAlreadyClaimed] = useState<bigint>(0n);
  const [unlocked, setUnlocked] = useState<bigint>(0n);
  const [claimable, setClaimable] = useState<bigint>(0n);
  const [_claimStart, setClaimStart] = useState<number>(0);
  const [_cliff, setCliff] = useState<number>(0);
  const [_duration, setDuration] = useState<number>(0);

  // Admin inputs
  const [carryOver, setCarryOver] = useState<boolean>(true);
  const [newEthR, setNewEthR] = useState("");
  const [newUsdtR, setNewUsdtR] = useState("");
  const [deadlinePhase, setDeadlinePhase] = useState("1");
  const [deadlineTs, setDeadlineTs] = useState("");
  const [capPhase, setCapPhase] = useState("1");
  const [capValue, setCapValue] = useState("");
  const [pricePhase, setPricePhase] = useState("1");
  const [price6, setPrice6] = useState("");
  const [withdrawTo, setWithdrawTo] = useState("");
  const [withdrawAmt, setWithdrawAmt] = useState("");
  const [endCliffMin, setEndCliffMin] = useState("2");      // minutes for quick tests
  const [endDurationMin, setEndDurationMin] = useState("6"); // minutes for quick tests

  const needsApprove = useMemo(() => {
    try {
      const want = ethers.parseUnits(usdtAmount || "0", usdtDecimals);
      return allowance < want;
    } catch {
      return true;
    }
  }, [allowance, usdtAmount, usdtDecimals]);

  async function getSigner() {
    if (!window.ethereum) throw new Error("No injected wallet");
    const provider = new ethers.BrowserProvider(window.ethereum);
    const signer = await provider.getSigner();
    const net = await provider.getNetwork();
    if (net.chainId !== BigInt(ACTIVE_CHAIN.id)) {
      throw new Error(`Wrong network. Please switch to ${ACTIVE_CHAIN.name}.`);
    }
    return signer;
  }

  async function readState(signer: ethers.Signer) {
    const presale = new ethers.Contract(PRESALE_ADDRESS, SAAD_PRESALE_USD_PRO_ABI, signer);
    // phase + price
    try {
      const p: bigint = await presale.currentPhase();
      setPhase(Number(p));
      const pr6: bigint = await presale.pricePerTokenUSDT(p);
      setUsdPrice(Number(pr6) / 1e6);
    } catch {}
    // ended + whitelist
    try {
      const ended: boolean = await presale.presaleEnded();
      setPresaleEnded(ended);
    } catch {}
    try {
      const wl: boolean = await presale.whitelistRequired();
      setWhitelistRequired(wl);
    } catch {}
    // vesting info (if any purchases)
    if (address) {
      try {
        const info = await presale.vestingInfo(address);
        setTotal(info.total);
        setAlreadyClaimed(info.alreadyClaimed);
        setUnlocked(info.unlocked);
        setClaimable(info.claimable);
        setClaimStart(Number(info._claimStart));
        setCliff(Number(info._cliff));
        setDuration(Number(info._duration));
      } catch {
        setTotal(0n); setAlreadyClaimed(0n); setUnlocked(0n); setClaimable(0n);
        setClaimStart(0); setCliff(0); setDuration(0);
      }
    }
    // usdt data
    try {
      const erc20 = new ethers.Contract(USDT_ADDRESS, ERC20_MIN_ABI, signer);
      const d: number = await erc20.decimals();
      setUsdtDecimals(d);
      const bal: bigint = await erc20.balanceOf(await signer.getAddress());
      setUsdtBalance(bal);
      const a: bigint = await erc20.allowance(await signer.getAddress(), PRESALE_ADDRESS);
      setAllowance(a);
    } catch {}
  }

  useEffect(() => {
    (async () => {
      if (!isConnected) return;
      const signer = await getSigner();
      await readState(signer);
    })();
  }, [isConnected, address]);

  // ETH buy
  async function handleBuyETH() {
    if (!isConnected) return alert("Connect wallet first.");
    try {
      setLoading(true);
      setTxStatus("Sending ETH transaction…");
      const signer = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, SAAD_PRESALE_USD_PRO_ABI, signer);
      const value = ethers.parseEther(ethAmount || "0.001");
      try { await presale.buyWithETH.staticCall({ value }); } catch {}
      const tx = await presale.buyWithETH({ value, gasLimit: 300000n });
      await tx.wait();
      await readState(signer);
      setTxStatus("✅ ETH purchase successful!");
    } catch (err: any) {
      setTxStatus(`❌ Failed: ${err?.reason || err?.message || err}`);
    } finally {
      setLoading(false);
    }
  }

  // USDT approve + buy
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
      const a: bigint = await erc20.allowance(await signer.getAddress(), PRESALE_ADDRESS);
      setAllowance(a);
      setTxStatus("✅ USDT approved!");
    } catch (err: any) {
      setTxStatus(`❌ Approve failed: ${err?.reason || err?.message || err}`);
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
      const presale = new ethers.Contract(PRESALE_ADDRESS, SAAD_PRESALE_USD_PRO_ABI, signer);
      const amount = ethers.parseUnits(usdtAmount || "0", usdtDecimals);
      try { await presale.buyWithUSDT.staticCall(amount); } catch {}
      const tx = await presale.buyWithUSDT(amount, { gasLimit: 300000n });
      await tx.wait();
      await readState(signer);
      setTxStatus("✅ USDT purchase successful!");
    } catch (err: any) {
      setTxStatus(`❌ USDT buy failed: ${err?.reason || err?.message || err}`);
    } finally {
      setLoading(false);
    }
  }

  // Claim
  async function handleClaim() {
    if (!isConnected) return alert("Connect wallet first.");
    try {
      setLoading(true);
      setTxStatus("Claiming…");
      const signer = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, SAAD_PRESALE_USD_PRO_ABI, signer);
      const tx = await presale.claim({ gasLimit: 300000n });
      await tx.wait();
      await readState(signer);
      setTxStatus("✅ Claim successful!");
    } catch (err: any) {
      setTxStatus(`❌ Claim failed: ${err?.reason || err?.message || err}`);
    } finally {
      setLoading(false);
    }
  }

  // Onramps
  function openTransak() {
    if (!address) return alert("Connect wallet first.");
    if (!TRANSAK_API_KEY || TRANSAK_API_KEY === "YOUR_TRANSAK_API_KEY") {
      alert("Set TRANSAK_API_KEY in src/constants.ts");
      return;
    }
    const params = new URLSearchParams({
      apiKey: TRANSAK_API_KEY,
      environment: "STAGING",
      walletAddress: address,
      defaultCryptoCurrency: "ETH",
      cryptoCurrencyCode: "ETH",
    });
    const url = `${TRANSAK_ENV_URL}?${params.toString()}`;
    window.open(url, "_blank", "width=420,height=720");
  }
  function openCoinbaseCheckout() {
    if (!COINBASE_CHECKOUT_ID || COINBASE_CHECKOUT_ID === "YOUR_COMMERCE_CHECKOUT_ID") {
      alert("Set COINBASE_CHECKOUT_ID in src/constants.ts");
      return;
    }
    window.open(`https://commerce.coinbase.com/checkout/${COINBASE_CHECKOUT_ID}`, "_blank");
  }

  // Admin
  async function adminPauseResume(pause: boolean) {
    try {
      const signer = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, SAAD_PRESALE_USD_PRO_ABI, signer);
      const tx = await (pause ? presale.pause() : presale.resume());
      await tx.wait();
      await readState(signer);
      alert(pause ? "Paused" : "Resumed");
    } catch (e: any) { alert(e?.reason || e?.message || String(e)); }
  }
  async function adminAdvance() {
    try {
      const signer = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, SAAD_PRESALE_USD_PRO_ABI, signer);
      const tx = await presale.advancePhase(carryOver);
      await tx.wait();
      await readState(signer);
      alert("Advanced phase");
    } catch (e: any) { alert(e?.reason || e?.message || String(e)); }
  }
  async function adminToggleWhitelist(required: boolean) {
    try {
      const signer = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, SAAD_PRESALE_USD_PRO_ABI, signer);
      const tx = await presale.setWhitelistRequired(required);
      await tx.wait();
      await readState(signer);
      alert(`Whitelist ${required ? "enabled" : "disabled"}`);
    } catch (e: any) { alert(e?.reason || e?.message || String(e)); }
  }
  async function adminSetReceivers() {
    try {
      const signer = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, SAAD_PRESALE_USD_PRO_ABI, signer);
      const tx = await presale.setReceivers(newEthR, newUsdtR);
      await tx.wait();
      alert("Receivers updated");
    } catch (e: any) { alert(e?.reason || e?.message || String(e)); }
  }
  async function adminSetDeadline() {
    try {
      const p = Number(deadlinePhase) - 1;
      const ts = BigInt(deadlineTs || "0");
      const signer = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, SAAD_PRESALE_USD_PRO_ABI, signer);
      const tx = await presale.setPhaseDeadline(p, ts);
      await tx.wait();
      alert("Deadline updated");
    } catch (e: any) { alert(e?.reason || e?.message || String(e)); }
  }
  async function adminSetCap() {
    try {
      const p = Number(capPhase) - 1;
      const cap = BigInt(capValue || "0");
      const signer = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, SAAD_PRESALE_USD_PRO_ABI, signer);
      const tx = await presale.setPhaseCap(p, cap);
      await tx.wait();
      alert("Cap updated");
    } catch (e: any) { alert(e?.reason || e?.message || String(e)); }
  }
  async function adminSetPrice() {
    try {
      const p = Number(pricePhase) - 1;
      const price = Number(price6 || "0"); // uint32
      const signer = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, SAAD_PRESALE_USD_PRO_ABI, signer);
      const tx = await presale.setPhasePrice(p, price);
      await tx.wait();
      await readState(signer);
      alert("Price updated");
    } catch (e: any) { alert(e?.reason || e?.message || String(e)); }
  }
  async function adminWithdrawUnsold() {
    try {
      const signer = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, SAAD_PRESALE_USD_PRO_ABI, signer);
      const to = withdrawTo;
      const amount = ethers.parseUnits(withdrawAmt || "0", 18);
      const tx = await presale.withdrawUnsold(to, amount);
      await tx.wait();
      alert("Unsold withdrawn");
    } catch (e: any) { alert(e?.reason || e?.message || String(e)); }
  }
  async function adminEndPresaleQuick() {
    try {
      const signer = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, SAAD_PRESALE_USD_PRO_ABI, signer);
      const nowSec = Math.floor(Date.now() / 1000);
      const cliff = Number(endCliffMin) * 60;
      const duration = Number(endDurationMin) * 60;
      const tx = await presale.endPresaleAndStartVesting(nowSec, cliff, duration);
      await tx.wait();
      await readState(signer);
      alert("Presale ended — vesting started");
    } catch (e: any) { alert(e?.reason || e?.message || String(e)); }
  }

  // Claim card helpers
  function secondsToHMS(s: number) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const ss = Math.floor(s % 60);
    return `${String(h).padStart(2,"0")}:${String(m).padStart(2,"0")}:${String(ss).padStart(2,"0")}`;
  }
  function ClaimCard() {
    const now = Math.floor(Date.now() / 1000);
    const untilCliff = Math.max(0, _claimStart + _cliff - now);
    const untilEnd   = Math.max(0, _claimStart + _duration - now);

    return (
      <div style={{ border: "1px solid #a78bfa", borderRadius: 12, padding: 16, maxWidth: 520, width: "100%", marginBottom: 16 }}>
        <h3>Vesting & Claim</h3>
        {!presaleEnded && <p style={{ color: "#f59e0b" }}>Presale not ended yet. Claim opens after ending.</p>}
        <p>Locked: <b>{fmt(total).toLocaleString()} SQ8</b></p>
        <p>Unlocked: <b>{fmt(unlocked).toLocaleString()} SQ8</b> — Claimed: <b>{fmt(alreadyClaimed).toLocaleString()} SQ8</b></p>
        {_duration > 0 ? (
          <>
            <p style={{ margin: 0, opacity: 0.9 }}>Cliff: {Math.floor(_cliff/60)} min — Total: {Math.floor(_duration/60)} min</p>
            <p style={{ margin: 0, opacity: 0.9 }}>Cliff countdown: {untilCliff>0 ? secondsToHMS(untilCliff) : "Reached"}</p>
            <p style={{ marginTop: 4, opacity: 0.9 }}>Fully vested in: {untilEnd>0 ? secondsToHMS(untilEnd) : "Completed"}</p>
          </>
        ) : (
          <p style={{ opacity: 0.8 }}>Vesting schedule will appear after you end the presale.</p>
        )}

        <button
          disabled={!presaleEnded || claimable === 0n || loading}
          onClick={handleClaim}
          style={{ padding: 12, background: "#8b5cf6", borderRadius: 8, width: "100%" }}
        >
          {loading ? "Processing…" : claimable === 0n ? "Nothing claimable yet" : `Claim ${fmt(claimable).toLocaleString()} SQ8`}
        </button>
      </div>
    );
  }

  return (
    <div className="app" style={{ minHeight: "100vh", padding: 24, color: "#fff", background: "#0d0d0d" }}>
      <h1 style={{ fontSize: 36, marginBottom: 4 }}>SAADverse Presale</h1>

      <p style={{ margin: 0, opacity: 0.9 }}>
        Current Phase: <b>{phase + 1}</b> &nbsp; | &nbsp; Price: <b>${usdPrice.toFixed(4)}</b> per SQ8
      </p>

      <p style={{ opacity: 0.8, marginTop: 8 }}>
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

      {/* Buy ETH */}
      <div style={{ border: "1px solid #39ff14", borderRadius: 12, padding: 16, maxWidth: 520, width: "100%", marginBottom: 16 }}>
        <h3>Buy with ETH</h3>
        <p style={{ fontSize: 12, opacity: 0.8, marginTop: 0 }}>ETH converts at the oracle rate; price shown is USD.</p>
        <input
          value={ethAmount}
          onChange={(e) => setEthAmount(e.target.value)}
          placeholder="Spend amount in ETH (e.g., 0.001)"
          style={{ width: "100%", padding: 10, borderRadius: 8, margin: "8px 0" }}
        />
        <button disabled={loading} onClick={handleBuyETH} style={{ padding: 12, background: "#16a34a", borderRadius: 8, width: "100%" }}>
          {loading ? "Processing…" : "Buy with ETH"}
        </button>
      </div>

      {/* Buy USDT */}
      <div style={{ border: "1px solid #60a5fa", borderRadius: 12, padding: 16, maxWidth: 520, width: "100%", marginBottom: 16 }}>
        <h3>Buy with USDT</h3>
        <p style={{ opacity: 0.8, fontSize: 12, marginTop: 0 }}>
          Balance: {fmt(usdtBalance, usdtDecimals).toLocaleString()} USDT — Allowance: {fmt(allowance, usdtDecimals).toLocaleString()} USDT
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
        <p style={{ fontSize: 12, opacity: 0.8 }}>USDT uses 6 decimals; price is fixed per phase in USD.</p>
      </div>

      {/* Onramps */}
      <div style={{ border: "1px solid #f59e0b", borderRadius: 12, padding: 16, maxWidth: 520, width: "100%" }}>
        <h3>Buy with Card / Apple Pay / PayPal</h3>
        <button onClick={openTransak} style={{ padding: 12, background: "#f59e0b", color: "#000", borderRadius: 8, width: "100%", marginBottom: 8 }}>
          Open Transak (Card / Apple Pay)
        </button>
        <button onClick={openCoinbaseCheckout} style={{ padding: 12, background: "#fff", color: "#000", borderRadius: 8, width: "100%" }}>
          Open Coinbase Commerce (Card / PayPal / Crypto)
        </button>
        <p style={{ fontSize: 12, opacity: 0.75, marginTop: 8 }}>
          Configure <code>TRANSAK_API_KEY</code> and <code>COINBASE_CHECKOUT_ID</code> in <code>src/constants.ts</code>.
        </p>
      </div>

      {/* Claim */}
      {isConnected && <ClaimCard />}

      {/* Admin (Owner Only) */}
      <div style={{ border: "1px solid #bbb", borderRadius: 12, padding: 16, maxWidth: 520, width: "100%", marginTop: 16 }}>
        <h3>Admin Panel (Owner Only)</h3>

        <div style={{ display: "grid", gap: 8, marginBottom: 12 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => adminPauseResume(true)}>Pause</button>
            <button onClick={() => adminPauseResume(false)}>Resume</button>
          </div>

          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <input type="checkbox" checked={carryOver} onChange={(e) => setCarryOver(e.target.checked)} /> Carry over unsold on advance
          </label>
          <button onClick={adminAdvance}>Advance Phase</button>

          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span>Whitelist required?</span>
            <button onClick={() => adminToggleWhitelist(true)}>Enable</button>
            <button onClick={() => adminToggleWhitelist(false)}>Disable</button>
            <span style={{ opacity: 0.75 }}>(now: {String(whitelistRequired)})</span>
          </div>

          <div>
            <input placeholder="ETH receiver" value={newEthR} onChange={(e)=>setNewEthR(e.target.value)} style={{ width:"100%", padding:8, borderRadius:8, marginBottom:6 }}/>
            <input placeholder="USDT receiver" value={newUsdtR} onChange={(e)=>setNewUsdtR(e.target.value)} style={{ width:"100%", padding:8, borderRadius:8, marginBottom:6 }}/>
            <button onClick={adminSetReceivers}>Set Receivers</button>
          </div>

          <div>
            <div style={{ display:"flex", gap:8, marginBottom:6 }}>
              <input placeholder="Phase (1-3)" value={deadlinePhase} onChange={(e)=>setDeadlinePhase(e.target.value)} style={{ flex: "0 0 110px", padding:8, borderRadius:8 }}/>
              <input placeholder="Deadline (unix seconds)" value={deadlineTs} onChange={(e)=>setDeadlineTs(e.target.value)} style={{ flex:1, padding:8, borderRadius:8 }}/>
            </div>
            <button onClick={adminSetDeadline}>Set Phase Deadline</button>
          </div>

          <div>
            <div style={{ display:"flex", gap:8, marginBottom:6 }}>
              <input placeholder="Phase (1-3)" value={capPhase} onChange={(e)=>setCapPhase(e.target.value)} style={{ flex:"0 0 110px", padding:8, borderRadius:8 }}/>
              <input placeholder="Cap (tokens, 18dp)" value={capValue} onChange={(e)=>setCapValue(e.target.value)} style={{ flex:1, padding:8, borderRadius:8 }}/>
            </div>
            <button onClick={adminSetCap}>Set Phase Cap</button>
          </div>

          <div>
            <div style={{ display:"flex", gap:8, marginBottom:6 }}>
              <input placeholder="Phase (1-3)" value={pricePhase} onChange={(e)=>setPricePhase(e.target.value)} style={{ flex:"0 0 110px", padding:8, borderRadius:8 }}/>
              <input placeholder="Price (USDT 6dp, e.g., 1600)" value={price6} onChange={(e)=>setPrice6(e.target.value)} style={{ flex:1, padding:8, borderRadius:8 }}/>
            </div>
            <button onClick={adminSetPrice}>Set Phase Price</button>
          </div>

          <div>
            <div style={{ display:"flex", gap:8, marginBottom:6 }}>
              <input placeholder="Withdraw to (address)" value={withdrawTo} onChange={(e)=>setWithdrawTo(e.target.value)} style={{ flex:1, padding:8, borderRadius:8 }}/>
              <input placeholder="Amount (tokens, 18dp)" value={withdrawAmt} onChange={(e)=>setWithdrawAmt(e.target.value)} style={{ flex:1, padding:8, borderRadius:8 }}/>
            </div>
            <button onClick={adminWithdrawUnsold}>Withdraw Unsold</button>
          </div>

          <div>
            <div style={{ display:"flex", gap:8, marginBottom:6 }}>
              <input placeholder="Cliff (minutes)" value={endCliffMin} onChange={(e)=>setEndCliffMin(e.target.value)} style={{ flex:1, padding:8, borderRadius:8 }}/>
              <input placeholder="Duration (minutes)" value={endDurationMin} onChange={(e)=>setEndDurationMin(e.target.value)} style={{ flex:1, padding:8, borderRadius:8 }}/>
            </div>
            <button onClick={adminEndPresaleQuick}>End Presale & Start Vesting</button>
          </div>
        </div>
      </div>

      {txStatus && <p style={{ marginTop: 12 }}>{txStatus}</p>}

      <footer style={{ marginTop: 32, opacity: 0.6, fontSize: 12 }}>© 2025 SAADverse — USD-pegged (Pro)</footer>
    </div>
  );
}
