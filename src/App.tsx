import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";

/** =========================================================
 *  CONFIG (edit or set via .env[.production])
 *  ========================================================= */
const PRESALE_ADDRESS = import.meta.env.VITE_PRESALE_ADDRESS || "0x00ab2677723295F2d0A79cb68E1893f9707B409D";
const USDT_ADDRESS    = import.meta.env.VITE_USDT_ADDRESS    || "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2";
const USDT_DECIMALS   = Number(import.meta.env.VITE_USDT_DECIMALS || 6);

// Admin gating
const OWNER_ADDRESS   = (import.meta.env.VITE_OWNER_ADDRESS || "").toLowerCase();

// Fiat on-ramps
const COINBASE_CHECKOUT_URL  = import.meta.env.VITE_COINBASE_CHECKOUT_URL || ""; // e.g. https://commerce.coinbase.com/checkout/XXXX
const TRANSAK_API_KEY        = import.meta.env.VITE_TRANSAK_API_KEY || "";
const TRANSAK_ENV            = import.meta.env.VITE_TRANSAK_ENV || "PRODUCTION"; // or "STAGING"
const TRANSAK_DEFAULT_CRYPTO = import.meta.env.VITE_TRANSAK_DEFAULT_CRYPTO || "ETH";

/** =========================================================
 *  ABIs (minimal set used by this app)
 *  Replace with full ABIs if you have them.
 *  ========================================================= */
const SAAD_PRESALE_USD_PRO_ABI = [
  // Buys
  "function buyWithETH() payable",
  "function buyWithUSDT(uint256 amount) returns (bool)",

  // Pricing
  "function priceUSDT6() view returns (uint256)",  // USDT price per SQ8 (6 dp)
  "function getEthUsd6() view returns (uint256)",  // USD per ETH in 6 dp

  // Admin (wrapped in try/catch)
  "function setPriceUSDT6(uint256) external",
  "function pause() external",
  "function unpause() external",
  "function withdraw() external",
];

const ERC20_MIN_ABI = [
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 value) returns (bool)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address owner) view returns (uint256)",
];

/** =========================================================
 *  ETHERS HELPERS
 *  ========================================================= */
function getProvider(): ethers.BrowserProvider {
  const { ethereum } = window as any;
  if (!ethereum) throw new Error("No injected wallet detected. Please install MetaMask or a compatible wallet.");
  return new ethers.BrowserProvider(ethereum);
}

// guard to avoid -32002 “Already processing eth_requestAccounts”
let connectInFlight = false;

async function getSigner(): Promise<ethers.Signer> {
  const provider = getProvider();

  // 1) Passive check (no popup)
  const accs = await provider.send("eth_accounts", []);
  if (accs && accs.length > 0) {
    return await provider.getSigner();
  }

  // 2) Request only if needed; avoid duplicate requests
  try {
    if (connectInFlight) {
      await new Promise((r) => setTimeout(r, 1200));
      const accs2 = await provider.send("eth_accounts", []);
      if (accs2 && accs2.length > 0) return await provider.getSigner();
      throw new Error("Wallet request already pending. Please approve/deny the MetaMask popup.");
    }
    connectInFlight = true;
    await provider.send("eth_requestAccounts", []);
    return await provider.getSigner();
  } catch (e: any) {
    if (e?.code === -32002) {
      throw new Error("A wallet connection request is already open. Please check your MetaMask window.");
    }
    throw e;
  } finally {
    connectInFlight = false;
  }
}

/** =========================================================
 *  APP
 *  ========================================================= */
export default function App() {
  // Wallet / network
  const [isConnected, setIsConnected] = useState(false);
  const [account, setAccount] = useState<string>("");
  const [chainId, setChainId] = useState<number | null>(null);

  // User inputs
  const [ethAmount, setEthAmount] = useState<string>("");
  const [usdtAmount, setUsdtAmount] = useState<string>("");
  const [desiredTokens, setDesiredTokens] = useState<string>(""); // Smart buy by SQ8 amt

  // Pricing
  const [priceUSDT6, setPriceUSDT6] = useState<bigint>(0n); // USDT per SQ8, 6 dp
  const [ethUsd6, setEthUsd6] = useState<bigint>(0n);       // USD per ETH, 6 dp
  const pricingLoaded = priceUSDT6 > 0n && ethUsd6 > 0n;

  // UI state
  const [loading, setLoading] = useState(false);
  const [txStatus, setTxStatus] = useState<string>("");

  // Admin state
  const [adminPriceUSDT6, setAdminPriceUSDT6] = useState<string>("");
  const isOwner = isConnected && !!account && account.toLowerCase() === OWNER_ADDRESS;

  // Interfaces
  const presaleInterface = useMemo(() => new ethers.Interface(SAAD_PRESALE_USD_PRO_ABI), []);
  const erc20Interface   = useMemo(() => new ethers.Interface(ERC20_MIN_ABI), []);

  /** ---------------------------------------------------------
   *  Wallet listeners (no eth_requestAccounts here)
   *  --------------------------------------------------------- */
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

  /** ---------------------------------------------------------
   *  Reading pricing from the contract
   *  --------------------------------------------------------- */
  async function readState(signerOrProvider?: ethers.Signer | ethers.Provider) {
    try {
      const provider = signerOrProvider ?? getProvider();
      const presale = new ethers.Contract(PRESALE_ADDRESS, presaleInterface, provider);

      const [p6, e6] = await Promise.all([
        presale.priceUSDT6().catch(() => 0n),
        presale.getEthUsd6().catch(() => 0n),
      ]);

      if (typeof p6 === "bigint" && p6 > 0n) setPriceUSDT6(p6);
      if (typeof e6 === "bigint" && e6 > 0n) setEthUsd6(e6);
    } catch (e) {
      console.warn("readState:", e);
    }
  }

  useEffect(() => {
    readState().catch(() => {});
  }, []);

  // Helper: ensure pricing is available (retry a few times)
  async function ensurePricing(): Promise<void> {
    if (priceUSDT6 > 0n && ethUsd6 > 0n) return;
    // try up to 3 times w/ small delay
    for (let i = 0; i < 3; i++) {
      await readState().catch(() => {});
      if (priceUSDT6 > 0n && ethUsd6 > 0n) return;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (!(priceUSDT6 > 0n)) throw new Error("Price unavailable (priceUSDT6 not ready).");
    if (!(ethUsd6 > 0n)) throw new Error("Pricing unavailable (ethUsd6 not ready).");
  }

  /** ---------------------------------------------------------
   *  Connect / Disconnect
   *  --------------------------------------------------------- */
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

  // MetaMask does not allow true programmatic disconnect. We clear local UI state.
  function disconnect() {
    setIsConnected(false);
    setAccount("");
    setChainId(null);
    setTxStatus("Wallet disconnected in app. If you wish to revoke access, open MetaMask → three dots → Connected sites.");
  }

  /** ---------------------------------------------------------
   *  BUY FLOWS
   *  --------------------------------------------------------- */
  async function handleBuyETH() {
    if (!isConnected) return alert("Connect wallet first.");
    try {
      setLoading(true);
      setTxStatus("Sending ETH transaction…");

      const signer  = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, presaleInterface, signer);

      const value = ethers.parseEther((ethAmount && ethAmount.trim()) || "0.001");
      const tx    = await presale.buyWithETH({ value, gasLimit: 300000n });

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

  async function handleBuyUSDT() {
    if (!isConnected) return alert("Connect wallet first.");
    try {
      setLoading(true);
      setTxStatus("Buying with USDT…");

      const signer  = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, presaleInterface, signer);
      const usdt    = new ethers.Contract(USDT_ADDRESS, erc20Interface, signer);

      const owner  = await signer.getAddress();
      const amount = ethers.parseUnits((usdtAmount || "0").trim(), USDT_DECIMALS);

      // approve if needed
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
      console.error(err);
      setTxStatus(`❌ USDT buy failed: ${err?.reason || err?.message || String(err)}`);
    } finally {
      setLoading(false);
    }
  }

  async function handleSmartBuyETH() {
    if (!isConnected) return alert("Connect wallet first.");
    try {
      setLoading(true);
      setTxStatus("Preparing ETH purchase…");

      // Ensure pricing is available
      await ensurePricing();

      const tokensWanted = parseFloat((desiredTokens || "").trim());
      if (!tokensWanted || tokensWanted <= 0) throw new Error("Enter SQ8 amount > 0");

      const signer  = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, presaleInterface, signer);

      // usd6 = tokensWanted * priceUSDT6
      const usd6  = BigInt(Math.ceil(tokensWanted * Number(priceUSDT6)));
      // wei = (usd6 * 1e18) / ethUsd6
      let ethWei = (usd6 * 1_000_000_000_000_000_000n) / ethUsd6;
      ethWei     = (ethWei * 102n) / 100n; // 2% buffer

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

  async function handleSmartBuyUSDT() {
    if (!isConnected) return alert("Connect wallet first.");
    try {
      setLoading(true);
      setTxStatus("Preparing USDT purchase…");

      // Ensure price is available (ethUsd6 not needed for USDT path)
      if (!(priceUSDT6 > 0n)) {
        for (let i = 0; i < 3; i++) {
          await readState().catch(() => {});
          if (priceUSDT6 > 0n) break;
          await new Promise((r) => setTimeout(r, 500));
        }
        if (!(priceUSDT6 > 0n)) throw new Error("Price unavailable (priceUSDT6 not ready).");
      }

      const tokensWanted = parseFloat((desiredTokens || "").trim());
      if (!tokensWanted || tokensWanted <= 0) throw new Error("Enter SQ8 amount > 0");

      const signer  = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, presaleInterface, signer);
      const usdt    = new ethers.Contract(USDT_ADDRESS, erc20Interface, signer);
      const owner   = await signer.getAddress();

      const usd6 = BigInt(Math.ceil(tokensWanted * Number(priceUSDT6)));

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
      console.error(e);
      setTxStatus(`❌ Failed: ${e?.reason || e?.message || String(e)}`);
    } finally {
      setLoading(false);
    }
  }

  /** ---------------------------------------------------------
   *  Fiat on-ramps
   *  --------------------------------------------------------- */
  function openCoinbaseCheckout() {
    if (!COINBASE_CHECKOUT_URL) {
      setTxStatus("❗ Set VITE_COINBASE_CHECKOUT_URL in .env");
      return;
    }
    window.open(COINBASE_CHECKOUT_URL, "_blank", "noopener,noreferrer");
  }

  function openTransak() {
    if (!TRANSAK_API_KEY) {
      setTxStatus("❗ Set VITE_TRANSAK_API_KEY in .env");
      return;
    }
    // Hosted URL docs: https://docs.transak.com/docs/hosted-url-parameters
    const base =
      TRANSAK_ENV === "STAGING"
        ? "https://staging-global.transak.com"
        : "https://global.transak.com";

    const params = new URLSearchParams({
      apiKey: TRANSAK_API_KEY,
      cryptoCurrencyCode: TRANSAK_DEFAULT_CRYPTO,
      walletAddress: account || "",
      themeColor: "5a4126", // desert-ish
      isFeeCalculationHidden: "true",
      hideMenu: "true",
      defaultNetwork: "base", // change to your target chain if needed
    });

    window.open(`${base}?${params.toString()}`, "_blank", "noopener,noreferrer");
  }

  /** ---------------------------------------------------------
   *  Admin panel
   *  --------------------------------------------------------- */
  async function adminSetPrice() {
    try {
      if (!isOwner) throw new Error("Not owner");
      const value = (adminPriceUSDT6 || "").trim();
      if (!/^\d+$/.test(value)) throw new Error("Enter integer price (USDT 6dp)");
      const signer  = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, presaleInterface, signer);
      const tx = await presale.setPriceUSDT6(BigInt(value));
      setTxStatus(`Admin tx pending… ${tx.hash}`);
      await tx.wait();
      await readState(signer);
      setTxStatus("✅ Price updated");
    } catch (e: any) {
      console.error(e);
      setTxStatus(`❌ Admin setPriceUSDT6 failed: ${e?.message || String(e)}`);
    }
  }

  async function adminPause() {
    try {
      if (!isOwner) throw new Error("Not owner");
      const signer  = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, presaleInterface, signer);
      const tx = await presale.pause();
      setTxStatus(`Admin tx pending… ${tx.hash}`);
      await tx.wait();
      setTxStatus("✅ Paused");
    } catch (e: any) {
      console.error(e);
      setTxStatus(`❌ Admin pause failed: ${e?.message || String(e)}`);
    }
  }

  async function adminUnpause() {
    try {
      if (!isOwner) throw new Error("Not owner");
      const signer  = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, presaleInterface, signer);
      const tx = await presale.unpause();
      setTxStatus(`Admin tx pending… ${tx.hash}`);
      await tx.wait();
      setTxStatus("✅ Unpaused");
    } catch (e: any) {
      console.error(e);
      setTxStatus(`❌ Admin unpause failed: ${e?.message || String(e)}`);
    }
  }

  async function adminWithdraw() {
    try {
      if (!isOwner) throw new Error("Not owner");
      const signer  = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, presaleInterface, signer);
      const tx = await presale.withdraw();
      setTxStatus(`Admin tx pending… ${tx.hash}`);
      await tx.wait();
      setTxStatus("✅ Withdrawn");
    } catch (e: any) {
      console.error(e);
      setTxStatus(`❌ Admin withdraw failed: ${e?.message || String(e)}`);
    }
  }

  /** =========================================================
   *  UI
   *  ========================================================= */
  return (
    <div
      className="app"
      style={{
        minHeight: "100vh",
        padding: 24,
        color: "#fff",
        background: "transparent", // keep transparent so page bg shows
        display: "grid",
        gap: 16,
      }}
    >
      {/* Top bar / wallet + fiat */}
      <header
        style={{
          display: "flex",
          gap: 12,
          alignItems: "center",
          flexWrap: "wrap",
          background: "rgba(0,0,0,0.4)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 12,
          padding: 12,
        }}
      >
        <button
          onClick={connect}
          disabled={isConnected || loading || connectInFlight}
          style={{ padding: "10px 14px", borderRadius: 8 }}
        >
          {isConnected ? "Wallet Connected" : loading ? "Connecting…" : "Connect Wallet"}
        </button>
        {isConnected && (
          <button
            onClick={disconnect}
            style={{ padding: "10px 14px", borderRadius: 8, background: "rgba(255,255,255,0.14)", border: "1px solid rgba(255,255,255,0.2)" }}
          >
            Disconnect
          </button>
        )}

        <div style={{ fontSize: 12, opacity: 0.9 }}>
          {account ? `Acct: ${account.slice(0, 6)}…${account.slice(-4)}` : "Not connected"}
          {chainId ? ` • ChainID: ${chainId}` : ""}
        </div>

        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={openCoinbaseCheckout} style={{ padding: "8px 12px", borderRadius: 8 }}>
            💳 Buy with Card (Coinbase)
          </button>
          <button onClick={openTransak} style={{ padding: "8px 12px", borderRadius: 8 }}>
            🌐 Buy with Card (Transak)
          </button>
          <button
            onClick={() => readState().then(() => setTxStatus("ℹ️ Pricing refreshed")).catch(() => setTxStatus("❌ Failed to refresh pricing"))}
            style={{ padding: "8px 12px", borderRadius: 8 }}
            title="Refresh priceUSDT6 / ethUsd6"
          >
            🔄 Refresh Pricing
          </button>
        </div>
      </header>

      {/* Pricing banner */}
      <div
        style={{
          background: "rgba(0,0,0,0.35)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 12,
          padding: 12,
          fontSize: 13,
        }}
      >
        Price (USDT 6dp / SQ8): <b>{priceUSDT6.toString()}</b> • ETH USD (6dp): <b>{ethUsd6.toString()}</b>
        {!pricingLoaded && <span style={{ marginLeft: 8, opacity: 0.9 }}>⏳ Loading on-chain pricing…</span>}
      </div>

      {/* BUY WITH ETH */}
      <section
        style={{
          background: "rgba(0,0,0,0.4)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 12,
          padding: 16,
          display: "grid",
          gap: 10,
        }}
      >
        <h3 style={{ margin: 0 }}>Buy with ETH</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            type="text"
            inputMode="decimal"
            placeholder="ETH amount (e.g. 0.01)"
            value={ethAmount}
            onChange={(e) => setEthAmount(e.target.value)}
            style={{
              flex: 1,
              minWidth: 220,
              padding: 10,
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(0,0,0,0.35)",
              color: "#fff",
            }}
          />
          <button onClick={handleBuyETH} disabled={loading} style={{ padding: "10px 14px", borderRadius: 8 }}>
            Buy
          </button>
        </div>
      </section>

      {/* BUY WITH USDT */}
      <section
        style={{
          background: "rgba(0,0,0,0.4)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 12,
          padding: 16,
          display: "grid",
          gap: 10,
        }}
      >
        <h3 style={{ margin: 0 }}>Buy with USDT</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            type="text"
            inputMode="decimal"
            placeholder={`USDT amount (${USDT_DECIMALS} dp)`}
            value={usdtAmount}
            onChange={(e) => setUsdtAmount(e.target.value)}
            style={{
              flex: 1,
              minWidth: 220,
              padding: 10,
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(0,0,0,0.35)",
              color: "#fff",
            }}
          />
          <button onClick={handleBuyUSDT} disabled={loading} style={{ padding: "10px 14px", borderRadius: 8 }}>
            Buy
          </button>
        </div>
      </section>

      {/* SMART BUY (by SQ8 amount) */}
      <section
        style={{
          background: "rgba(0,0,0,0.4)",
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 12,
          padding: 16,
          display: "grid",
          gap: 10,
        }}
      >
        <h3 style={{ margin: 0 }}>Smart Buy by SQ8 amount</h3>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input
            type="text"
            inputMode="decimal"
            placeholder="Desired SQ8 amount"
            value={desiredTokens}
            onChange={(e) => setDesiredTokens(e.target.value)}
            style={{
              flex: 1,
              minWidth: 220,
              padding: 10,
              borderRadius: 8,
              border: "1px solid rgba(255,255,255,0.15)",
              background: "rgba(0,0,0,0.35)",
              color: "#fff",
            }}
          />
          <button onClick={handleSmartBuyETH} disabled={loading} style={{ padding: "10px 14px", borderRadius: 8 }}>
            Buy with ETH
          </button>
          <button onClick={handleSmartBuyUSDT} disabled={loading} style={{ padding: "10px 14px", borderRadius: 8 }}>
            Buy with USDT
          </button>
        </div>
      </section>

      {/* ADMIN PANEL (only owner) */}
      {isOwner ? (
        <section
          style={{
            background: "rgba(30,20,10,0.55)",
            border: "1px solid rgba(255,255,255,0.18)",
            borderRadius: 12,
            padding: 16,
            display: "grid",
            gap: 12,
          }}
        >
          <h3 style={{ margin: 0 }}>Admin Panel</h3>

          <div style={{ display: "grid", gap: 8 }}>
            {/* Set priceUSDT6 */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              <input
                type="text"
                inputMode="numeric"
                placeholder="New priceUSDT6 (integer)"
                value={adminPriceUSDT6}
                onChange={(e) => setAdminPriceUSDT6(e.target.value)}
                style={{
                  flex: 1,
                  minWidth: 220,
                  padding: 10,
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.15)",
                  background: "rgba(0,0,0,0.35)",
                  color: "#fff",
                }}
              />
              <button onClick={adminSetPrice} style={{ padding: "10px 14px", borderRadius: 8 }}>
                Set Price
              </button>
            </div>

            {/* Pause / Unpause / Withdraw */}
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button onClick={adminPause} style={{ padding: "10px 14px", borderRadius: 8 }}>
                Pause
              </button>
              <button onClick={adminUnpause} style={{ padding: "10px 14px", borderRadius: 8 }}>
                Unpause
              </button>
              <button onClick={adminWithdraw} style={{ padding: "10px 14px", borderRadius: 8 }}>
                Withdraw
              </button>
            </div>
          </div>

          <div style={{ fontSize: 12, opacity: 0.8 }}>
            Visible only when connected wallet equals{" "}
            <code>{OWNER_ADDRESS || "(VITE_OWNER_ADDRESS not set)"}</code>
          </div>
        </section>
      ) : (
        <div
          style={{
            background: "rgba(0,0,0,0.35)",
            border: "1px solid rgba(255,255,255,0.12)",
            borderRadius: 12,
            padding: 12,
            fontSize: 13,
          }}
        >
          Admin Panel hidden. Connect with the owner wallet (
          <code>{OWNER_ADDRESS || "set VITE_OWNER_ADDRESS in .env"}</code>) to manage presale.
        </div>
      )}

      {/* Status / messages */}
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
  );
}
