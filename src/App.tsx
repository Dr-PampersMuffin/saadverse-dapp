import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";

/* =========================
   CONFIG (.env preferred)
   ========================= */
const PRESALE_ADDRESS = import.meta.env.VITE_PRESALE_ADDRESS || "0xYOUR_PRESALE_ADDRESS";
const USDT_ADDRESS    = import.meta.env.VITE_USDT_ADDRESS    || "0xYOUR_USDT_ADDRESS";
const USDT_DECIMALS   = Number(import.meta.env.VITE_USDT_DECIMALS || 6);

const OWNER_ADDRESS   = (import.meta.env.VITE_OWNER_ADDRESS || "").toLowerCase();

const COINBASE_CHECKOUT_URL  = import.meta.env.VITE_COINBASE_CHECKOUT_URL || "";
const TRANSAK_API_KEY        = import.meta.env.VITE_TRANSAK_API_KEY || "";
const TRANSAK_ENV            = import.meta.env.VITE_TRANSAK_ENV || "PRODUCTION";
const TRANSAK_DEFAULT_CRYPTO = import.meta.env.VITE_TRANSAK_DEFAULT_CRYPTO || "ETH";

/* =========================
   Minimal ABIs
   ========================= */
const SAAD_PRESALE_USD_PRO_ABI = [
  "function buyWithETH() payable",
  "function buyWithUSDT(uint256 amount) returns (bool)",
  // common price getters (we’ll probe dynamically too)
  "function priceUSDT6() view returns (uint256)",
  "function getEthUsd6() view returns (uint256)",
  // admin (optional)
  "function setPriceUSDT6(uint256) external",
  "function pause() external",
  "function unpause() external",
  "function withdraw() external",
];

const ERC20_MIN_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
];

/* =========================
   Helpers
   ========================= */
function getProvider(): ethers.BrowserProvider {
  const { ethereum } = window as any;
  if (!ethereum) throw new Error("No injected wallet detected. Please install MetaMask or a compatible wallet.");
  return new ethers.BrowserProvider(ethereum);
}

let connectInFlight = false;

async function getSigner(): Promise<ethers.Signer> {
  const provider = getProvider();
  const accs = await provider.send("eth_accounts", []);
  if (accs && accs.length > 0) return provider.getSigner();

  try {
    if (connectInFlight) {
      await new Promise((r) => setTimeout(r, 1200));
      const accs2 = await provider.send("eth_accounts", []);
      if (accs2 && accs2.length > 0) return provider.getSigner();
      throw new Error("Wallet request already pending. Please approve/deny the MetaMask popup.");
    }
    connectInFlight = true;
    await provider.send("eth_requestAccounts", []);
    return provider.getSigner();
  } catch (e: any) {
    if (e?.code === -32002) throw new Error("A wallet connection request is already open. Check your MetaMask window.");
    throw e;
  } finally {
    connectInFlight = false;
  }
}

/** Probe several common function names for price getters.
 *  This avoids “Pricing unavailable” when your contract uses different names.
 */
async function getFreshPricing(
  presale: ethers.Contract
): Promise<{ p6: bigint; e6: bigint }> {
  const priceFns = ["priceUSDT6", "sq8PriceUSDT6", "tokenPriceUSDT6", "usdtPrice6"];
  const ethFns   = ["getEthUsd6", "ethUsd6", "getEthUsd"];

  let p6: bigint = 0n;
  for (const fn of priceFns) {
    if (typeof (presale as any)[fn] === "function") {
      try {
        const v = await (presale as any)[fn]();
        if (typeof v === "bigint" && v > 0n) { p6 = v; break; }
        // some providers return as BigNumber-like in legacy; ethers v6 should be bigint
      } catch {}
    }
  }

  let e6: bigint = 0n;
  for (const fn of ethFns) {
    if (typeof (presale as any)[fn] === "function") {
      try {
        const v = await (presale as any)[fn]();
        if (typeof v === "bigint" && v > 0n) { e6 = v; break; }
      } catch {}
    }
  }

  return { p6, e6 };
}

/* =========================
   App
   ========================= */
export default function App() {
  const [isConnected, setIsConnected] = useState(false);
  const [account, setAccount] = useState<string>("");
  const [chainId, setChainId] = useState<number | null>(null);

  const [ethAmount, setEthAmount] = useState<string>("");
  const [usdtAmount, setUsdtAmount] = useState<string>("");
  const [desiredTokens, setDesiredTokens] = useState<string>("");

  // cached state (used for banner only; Smart Buy fetches fresh every click)
  const [priceUSDT6, setPriceUSDT6] = useState<bigint>(0n);
  const [ethUsd6, setEthUsd6] = useState<bigint>(0n);

  const [loading, setLoading] = useState(false);
  const [txStatus, setTxStatus] = useState("");

  const [adminPriceUSDT6, setAdminPriceUSDT6] = useState("");
  const isOwner = isConnected && account && account.toLowerCase() === OWNER_ADDRESS;

  const presaleInterface = useMemo(() => new ethers.Interface(SAAD_PRESALE_USD_PRO_ABI), []);
  const erc20Interface   = useMemo(() => new ethers.Interface(ERC20_MIN_ABI), []);

  /* Wallet listeners */
  useEffect(() => {
    const { ethereum } = window as any;
    if (!ethereum) return;

    const onAccounts = (accs: string[]) => {
      const a = accs?.[0] || "";
      setAccount(a);
      setIsConnected(!!a);
    };
    const onChain = (cidHex: string) => setChainId(parseInt(cidHex, 16));

    ethereum.request({ method: "eth_accounts" }).then(onAccounts);
    ethereum.request({ method: "eth_chainId" }).then(onChain);

    ethereum.on?.("accountsChanged", onAccounts);
    ethereum.on?.("chainChanged", onChain);
    return () => {
      ethereum.removeListener?.("accountsChanged", onAccounts);
      ethereum.removeListener?.("chainChanged", onChain);
    };
  }, []);

  /* Read pricing once for banner */
  async function readState(signerOrProvider?: ethers.Signer | ethers.Provider) {
    try {
      const provider = signerOrProvider ?? getProvider();
      const presale  = new ethers.Contract(PRESALE_ADDRESS, presaleInterface, provider);
      const { p6, e6 } = await getFreshPricing(presale);
      if (p6 > 0n) setPriceUSDT6(p6);
      if (e6 > 0n) setEthUsd6(e6);
    } catch (e) {
      console.warn("readState:", e);
    }
  }
  useEffect(() => { readState().catch(() => {}); }, []);

  /* Connect / Disconnect */
  async function connect() {
    if (connectInFlight) return;
    connectInFlight = true;
    setTxStatus("");
    try {
      setLoading(true);
      const signer = await getSigner();
      const addr   = await signer.getAddress();
      setAccount(addr);
      setIsConnected(true);

      const net = await (signer.provider as ethers.BrowserProvider).getNetwork();
      setChainId(Number(net.chainId));
      await readState(signer);
    } catch (e: any) {
      const msg = e?.message || String(e);
      if (msg.includes("already open") || e?.code === -32002) {
        setTxStatus("🔔 Wallet prompt is already open. Please check your MetaMask window.");
      } else {
        setTxStatus(`❌ Connect failed: ${msg}`);
      }
    } finally {
      setLoading(false);
      connectInFlight = false;
    }
  }

  function disconnect() {
    setIsConnected(false);
    setAccount("");
    setChainId(null);
    setTxStatus("Wallet disconnected in app. To revoke site access, use MetaMask → Connected sites.");
  }

  /* BUY: ETH (manual amount) */
  async function handleBuyETH() {
    if (!isConnected) return alert("Connect wallet first.");
    try {
      setLoading(true);
      setTxStatus("Sending ETH transaction…");
      const signer  = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, presaleInterface, signer);
      const value   = ethers.parseEther((ethAmount && ethAmount.trim()) || "0.001");
      const tx      = await presale.buyWithETH({ value, gasLimit: 300000n });
      setTxStatus(`Pending… ${tx.hash}`);
      await tx.wait();
      await readState(signer);
      setTxStatus("✅ ETH purchase successful!");
    } catch (err: any) {
      setTxStatus(`❌ Failed: ${err?.reason || err?.message || String(err)}`);
    } finally { setLoading(false); }
  }

  /* BUY: USDT (manual amount) */
  async function handleBuyUSDT() {
    if (!isConnected) return alert("Connect wallet first.");
    try {
      setLoading(true);
      setTxStatus("Buying with USDT…");
      const signer  = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, presaleInterface, signer);
      const usdt    = new ethers.Contract(USDT_ADDRESS, erc20Interface, signer);
      const owner   = await signer.getAddress();
      const amount  = ethers.parseUnits((usdtAmount || "0").trim(), USDT_DECIMALS);
      const current = (await usdt.allowance(owner, PRESALE_ADDRESS)) as bigint;
      if (current < amount) {
        setTxStatus("Approving USDT…");
        const txA = await usdt.approve(PRESALE_ADDRESS, amount);
        await txA.wait();
      }
      const tx = await presale.buyWithUSDT(amount);
      setTxStatus(`Pending… ${tx.hash}`);
      await tx.wait();
      await readState(signer);
      setTxStatus("✅ USDT purchase successful!");
    } catch (err: any) {
      setTxStatus(`❌ USDT buy failed: ${err?.reason || err?.message || String(err)}`);
    } finally { setLoading(false); }
  }

  /* SMART BUY: by SQ8 amount → compute ETH needed using fresh on-chain prices */
  async function handleSmartBuyETH() {
    if (!isConnected) return alert("Connect wallet first.");
    try {
      setLoading(true);
      setTxStatus("Preparing ETH purchase…");
      const tokensWanted = parseFloat((desiredTokens || "").trim());
      if (!tokensWanted || tokensWanted <= 0) throw new Error("Enter SQ8 amount > 0");

      const signer  = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, presaleInterface, signer);

      // Always fetch fresh prices here:
      const { p6, e6 } = await getFreshPricing(presale);
      if (!(p6 > 0n)) throw new Error("Price unavailable (priceUSDT6 not found on contract).");
      if (!(e6 > 0n)) throw new Error("ETH/USD price unavailable (getEthUsd6 not found on contract).");

      // usd6 = tokensWanted * priceUSDT6
      const usd6  = BigInt(Math.ceil(tokensWanted * Number(p6)));
      // wei = (usd6 * 1e18) / e6
      let ethWei = (usd6 * 1_000_000_000_000_000_000n) / e6;
      ethWei     = (ethWei * 102n) / 100n; // +2% buffer

      const tx = await presale.buyWithETH({ value: ethWei, gasLimit: 300000n });
      setTxStatus(`Pending… ${tx.hash}`);
      await tx.wait();

      await readState(signer);
      setTxStatus("✅ ETH purchase successful!");
    } catch (e: any) {
      setTxStatus(`❌ Failed: ${e?.reason || e?.message || String(e)}`);
    } finally { setLoading(false); }
  }

  /* SMART BUY: by SQ8 amount → compute USDT needed using fresh on-chain price */
  async function handleSmartBuyUSDT() {
    if (!isConnected) return alert("Connect wallet first.");
    try {
      setLoading(true);
      setTxStatus("Preparing USDT purchase…");
      const tokensWanted = parseFloat((desiredTokens || "").trim());
      if (!tokensWanted || tokensWanted <= 0) throw new Error("Enter SQ8 amount > 0");

      const signer  = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, presaleInterface, signer);
      const usdt    = new ethers.Contract(USDT_ADDRESS, erc20Interface, signer);
      const owner   = await signer.getAddress();

      // Always fetch fresh USDT price here:
      const { p6 } = await getFreshPricing(presale);
      if (!(p6 > 0n)) throw new Error("Price unavailable (priceUSDT6 not found on contract).");

      const usd6 = BigInt(Math.ceil(tokensWanted * Number(p6)));

      const current = (await usdt.allowance(owner, PRESALE_ADDRESS)) as bigint;
      if (current < usd6) {
        setTxStatus("Approving USDT…");
        const txA = await usdt.approve(PRESALE_ADDRESS, usd6);
        await txA.wait();
      }

      const tx = await presale.buyWithUSDT(usd6);
      setTxStatus(`Pending… ${tx.hash}`);
      await tx.wait();

      await readState(signer);
      setTxStatus("✅ USDT purchase successful!");
    } catch (e: any) {
      setTxStatus(`❌ Failed: ${e?.reason || e?.message || String(e)}`);
    } finally { setLoading(false); }
  }

  /* On-ramps */
  function openCoinbaseCheckout() {
    if (!COINBASE_CHECKOUT_URL) { setTxStatus("❗ Set VITE_COINBASE_CHECKOUT_URL in .env"); return; }
    window.open(COINBASE_CHECKOUT_URL, "_blank", "noopener,noreferrer");
  }
  function openTransak() {
    if (!TRANSAK_API_KEY) { setTxStatus("❗ Set VITE_TRANSAK_API_KEY in .env"); return; }
    const base = TRANSAK_ENV === "STAGING" ? "https://staging-global.transak.com" : "https://global.transak.com";
    const params = new URLSearchParams({
      apiKey: TRANSAK_API_KEY,
      cryptoCurrencyCode: TRANSAK_DEFAULT_CRYPTO,
      walletAddress: account || "",
      themeColor: "5a4126",
      isFeeCalculationHidden: "true",
      hideMenu: "true",
      defaultNetwork: "base",
    });
    window.open(`${base}?${params.toString()}`, "_blank", "noopener,noreferrer");
  }

  /* Admin */
  async function adminSetPrice() {
    try {
      if (!isOwner) throw new Error("Not owner");
      const v = (adminPriceUSDT6 || "").trim();
      if (!/^\d+$/.test(v)) throw new Error("Enter integer price (USDT 6dp)");
      const signer  = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, presaleInterface, signer);
      const tx = await presale.setPriceUSDT6(BigInt(v));
      setTxStatus(`Admin tx pending… ${tx.hash}`);
      await tx.wait();
      await readState(signer);
      setTxStatus("✅ Price updated");
    } catch (e: any) {
      setTxStatus(`❌ Admin setPriceUSDT6 failed: ${e?.message || String(e)}`);
    }
  }
  async function adminPause() {
    try { if (!isOwner) throw new Error("Not owner");
      const signer = await getSigner(); const presale = new ethers.Contract(PRESALE_ADDRESS, presaleInterface, signer);
      const tx = await presale.pause(); setTxStatus(`Admin tx pending… ${tx.hash}`); await tx.wait(); setTxStatus("✅ Paused");
    } catch (e: any) { setTxStatus(`❌ Admin pause failed: ${e?.message || String(e)}`); }
  }
  async function adminUnpause() {
    try { if (!isOwner) throw new Error("Not owner");
      const signer = await getSigner(); const presale = new ethers.Contract(PRESALE_ADDRESS, presaleInterface, signer);
      const tx = await presale.unpause(); setTxStatus(`Admin tx pending… ${tx.hash}`); await tx.wait(); setTxStatus("✅ Unpaused");
    } catch (e: any) { setTxStatus(`❌ Admin unpause failed: ${e?.message || String(e)}`); }
  }
  async function adminWithdraw() {
    try { if (!isOwner) throw new Error("Not owner");
      const signer = await getSigner(); const presale = new ethers.Contract(PRESALE_ADDRESS, presaleInterface, signer);
      const tx = await presale.withdraw(); setTxStatus(`Admin tx pending… ${tx.hash}`); await tx.wait(); setTxStatus("✅ Withdrawn");
    } catch (e: any) { setTxStatus(`❌ Admin withdraw failed: ${e?.message || String(e)}`); }
  }

  const pricingLoaded = priceUSDT6 > 0n && ethUsd6 > 0n;

  /* UI */
  return (
    <div style={{ minHeight: "100vh", padding: 24, color: "#fff", background: "transparent", display: "grid", gap: 16 }}>
      {/* Top bar */}
      <header style={{ display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap",
                       background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.12)",
                       borderRadius: 12, padding: 12 }}>
        {!isConnected ? (
          <button onClick={connect} disabled={loading || connectInFlight} style={{ padding: "10px 14px", borderRadius: 8 }}>
            {loading ? "Connecting…" : "Connect Wallet"}
          </button>
        ) : (
          <>
            <button disabled style={{ padding: "10px 14px", borderRadius: 8 }}>Wallet Connected</button>
            <button onClick={disconnect} style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.2)" }}>
              Disconnect
            </button>
          </>
        )}

        <div style={{ fontSize: 12, opacity: 0.9 }}>
          {account ? `Acct: ${account.slice(0, 6)}…${account.slice(-4)}` : "Not connected"}
          {chainId ? ` • ChainID: ${chainId}` : ""}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={openCoinbaseCheckout} style={{ padding: "8px 12px", borderRadius: 8 }}>💳 Coinbase</button>
          <button onClick={openTransak} style={{ padding: "8px 12px", borderRadius: 8 }}>🌐 Transak</button>
          <button onClick={() => readState().then(() => setTxStatus("ℹ️ Pricing refreshed")).catch(() => setTxStatus("❌ Failed to refresh pricing"))}
                  style={{ padding: "8px 12px", borderRadius: 8 }} title="Refresh priceUSDT6 / ethUsd6">
            🔄 Refresh Pricing
          </button>
        </div>
      </header>

      {/* Pricing banner */}
      <div style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.12)",
                    borderRadius: 12, padding: 12, fontSize: 13 }}>
        Price (USDT 6dp / SQ8): <b>{priceUSDT6.toString()}</b> • ETH USD (6dp): <b>{ethUsd6.toString()}</b>
        {!pricingLoaded && <span style={{ marginLeft: 8, opacity: 0.9 }}>⏳ Loading on-chain pricing…</span>}
      </div>

      {/* Buy ETH */}
      <section style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 12, padding: 16, display: "grid", gap: 10 }}>
        <h3 style={{ margin: 0 }}>Buy with ETH</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input type="text" inputMode="decimal" placeholder="ETH amount (e.g. 0.01)"
                 value={ethAmount} onChange={(e) => setEthAmount(e.target.value)}
                 style={{ flex: 1, minWidth: 220, padding: 10, borderRadius: 8,
                          border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "#fff" }} />
          <button onClick={handleBuyETH} disabled={loading} style={{ padding: "10px 14px", borderRadius: 8 }}>Buy</button>
        </div>
      </section>

      {/* Buy USDT */}
      <section style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 12, padding: 16, display: "grid", gap: 10 }}>
        <h3 style={{ margin: 0 }}>Buy with USDT</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input type="text" inputMode="decimal" placeholder={`USDT amount (${USDT_DECIMALS} dp)`}
                 value={usdtAmount} onChange={(e) => setUsdtAmount(e.target.value)}
                 style={{ flex: 1, minWidth: 220, padding: 10, borderRadius: 8,
                          border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "#fff" }} />
          <button onClick={handleBuyUSDT} disabled={loading} style={{ padding: "10px 14px", borderRadius: 8 }}>Buy</button>
        </div>
      </section>

      {/* Smart Buy */}
      <section style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.12)",
                        borderRadius: 12, padding: 16, display: "grid", gap: 10 }}>
        <h3 style={{ margin: 0 }}>Smart Buy by SQ8 amount</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input type="text" inputMode="decimal" placeholder="Desired SQ8 amount"
                 value={desiredTokens} onChange={(e) => setDesiredTokens(e.target.value)}
                 style={{ flex: 1, minWidth: 220, padding: 10, borderRadius: 8,
                          border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "#fff" }} />
          <button onClick={handleSmartBuyETH} disabled={loading} style={{ padding: "10px 14px", borderRadius: 8 }}>
            Buy with ETH
          </button>
          <button onClick={handleSmartBuyUSDT} disabled={loading} style={{ padding: "10px 14px", borderRadius: 8 }}>
            Buy with USDT
          </button>
        </div>
      </section>

      {/* Admin */}
      {isOwner ? (
        <section style={{ background: "rgba(30,20,10,0.55)", border: "1px solid rgba(255,255,255,0.18)",
                          borderRadius: 12, padding: 16, display: "grid", gap: 12 }}>
          <h3 style={{ margin: 0 }}>Admin Panel</h3>
          <div style={{ display: "grid", gap: 8 }}>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input type="text" inputMode="numeric" placeholder="New priceUSDT6 (integer)"
                     value={adminPriceUSDT6} onChange={(e) => setAdminPriceUSDT6(e.target.value)}
                     style={{ flex: 1, minWidth: 220, padding: 10, borderRadius: 8,
                              border: "1px solid rgba(255,255,255,0.15)", background: "rgba(0,0,0,0.35)", color: "#fff" }} />
              <button onClick={adminSetPrice} style={{ padding: "10px 14px", borderRadius: 8 }}>Set Price</button>
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={adminPause}    style={{ padding: "10px 14px", borderRadius: 8 }}>Pause</button>
              <button onClick={adminUnpause}  style={{ padding: "10px 14px", borderRadius: 8 }}>Unpause</button>
              <button onClick={adminWithdraw} style={{ padding: "10px 14px", borderRadius: 8 }}>Withdraw</button>
            </div>
          </div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>
            Visible only when connected wallet equals <code>{OWNER_ADDRESS || "(VITE_OWNER_ADDRESS not set)"}</code>
          </div>
        </section>
      ) : (
        <div style={{ background: "rgba(0,0,0,0.35)", border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 12, padding: 12, fontSize: 13 }}>
          Admin Panel hidden. Connect with the owner wallet (
          <code>{OWNER_ADDRESS || "set VITE_OWNER_ADDRESS in .env"}</code>) to manage presale.
        </div>
      )}

      {!!txStatus && (
        <div style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.12)",
                      borderRadius: 12, padding: 12, fontSize: 14 }}>
          {txStatus}
        </div>
      )}
    </div>
  );
}
