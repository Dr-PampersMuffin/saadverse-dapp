import React, { useEffect, useMemo, useState } from "react";
import { ethers } from "ethers";

/** =========================
 *  CONFIG – EDIT THESE or via .env
 *  ========================= */
const PRESALE_ADDRESS = import.meta.env.VITE_PRESALE_ADDRESS || "0x00ab2677723295F2d0A79cb68E1893f9707B409D";
const USDT_ADDRESS    = import.meta.env.VITE_USDT_ADDRESS    || "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2";
const USDT_DECIMALS   = Number(import.meta.env.VITE_USDT_DECIMALS || 6);

// gating admin
const OWNER_ADDRESS   = (import.meta.env.VITE_OWNER_ADDRESS || "").toLowerCase();

// external providers
const COINBASE_CHECKOUT_URL = import.meta.env.VITE_COINBASE_CHECKOUT_URL || ""; // e.g. https://commerce.coinbase.com/checkout/XXXX
const TRANSAK_API_KEY       = import.meta.env.VITE_TRANSAK_API_KEY || "";       // required for hosted URL
const TRANSAK_ENV           = import.meta.env.VITE_TRANSAK_ENV || "PRODUCTION"; // or "STAGING"
const TRANSAK_DEFAULT_CRYPTO = import.meta.env.VITE_TRANSAK_DEFAULT_CRYPTO || "ETH";

/**
 * Minimal ABIs for functions used below.
 * Replace with your full ABIs if you have them.
 */
const SAAD_PRESALE_USD_PRO_ABI = [
  // Buy methods
  "function buyWithETH() payable",
  "function buyWithUSDT(uint256 amount) returns (bool)",

  // Read helpers (adjust to your contract if names differ)
  "function priceUSDT6() view returns (uint256)",   // price per SQ8 in USDT with 6 decimals
  "function getEthUsd6() view returns (uint256)",   // ETH price in USD*1e6

  // --- Admin (optional, will try/catch gracefully if not present) ---
  "function setPriceUSDT6(uint256) external",
  "function pause() external",
  "function unpause() external",
  "function withdraw() external",
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
  const [ethUsd6, setEthUsd6] = useState<bigint>(0n);       // USD per 1 ETH in 1e6

  // UI state
  const [loading, setLoading] = useState(false);
  const [txStatus, setTxStatus] = useState<string>("");

  // Admin state
  const [adminPriceUSDT6, setAdminPriceUSDT6] = useState<string>(""); // plain number string
  const isOwner = isConnected && !!account && account.toLowerCase() === OWNER_ADDRESS;

  const presaleInterface = useMemo(() => new ethers.Interface(SAAD_PRESALE_USD_PRO_ABI), []);
  const erc20Interface = useMemo(() => new ethers.Interface(ERC20_MIN_ABI), []);

  /** Connect & listeners */
  useEffect(() => {
    const { ethereum } = window as any;
    if (!ethereum) return;

    const onAccounts = (accs: string[]) => {
      const a = accs?.[0] || "";
      setAccount(a);
      setIsConnected(!!a);
    };
    const onChain = (cidHex: string) => {
      setChainId(parseInt(cidHex, 16));
    };

    ethereum.request({ method: "eth_accounts" }).then(onAccounts);
    ethereum.request({ method: "eth_chainId" }).then(onChain);

    ethereum.on?.("accountsChanged", onAccounts);
    ethereum.on?.("chainChanged", onChain);
    return () => {
      ethereum.removeListener?.("accountsChanged", onAccounts);
      ethereum.removeListener?.("chainChanged", onChain);
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

      if (typeof p6 === "bigint") setPriceUSDT6(p6);
      if (typeof e6 === "bigint") setEthUsd6(e6);
    } catch (e) {
      console.warn("readState:", e);
    }
  }
  useEffect(() => { readState().catch(() => {}); }, []);

  /** Connect */
  async function connect() {
    try {
      const signer = await getSigner();
      const addr = await signer.getAddress();
      setAccount(addr); setIsConnected(true);

      const net = await (signer.provider as ethers.BrowserProvider).getNetwork();
      setChainId(Number(net.chainId));
      await readState(signer);
    } catch (e: any) {
      alert(e?.message || String(e));
    }
  }

  /** ========== BUY FLOWS ========== */
  async function handleBuyETH() {
    if (!isConnected) return alert("Connect wallet first.");
    try {
      setLoading(true);
      setTxStatus("Sending ETH transaction…");

      const signer = await getSigner();
      const presale = new ethers.Contract(PRESALE_ADDRESS, presaleInterface, signer);
      const value = ethers.parseEther((ethAmount && ethAmount.trim()) || "0.001");

      const tx = await presale.buyWithETH({ value, gasLimit: 300000n });
      setTxStatus(`Pending… ${tx.hash}`);
      await tx.wait();

      await readState(signer);
      setTxStatus("✅ ETH purchase successful!");
    } catch (err: any) {
      console.error(err);
      setTxStatus(`❌ Failed: ${err?.reason || err?.message || String(err)}`);
    } finally { setLoading(false); }
  }

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
    } finally { setLoading(false); }
  }

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

      const usd6 = BigInt(Math.ceil(tokensWanted * Number(priceUSDT6)));
      let ethWei = (usd6 * 1_000_000_000_000_000_000n) / ethUsd6;
      ethWei = (ethWei * 102n) / 100n; // +2% buffer

      const tx = await presale.buyWithETH({ value: ethWei, gasLimit: 300000n });
      setTxStatus(`Pending… ${tx.hash}`);
      await tx.wait();

      await readState(signer);
      setTxStatus("✅ ETH purchase successful!");
    } catch (e: any) {
      console.error(e);
      setTxStatus(`❌ Failed: ${e?.reason || e?.message || String(e)}`);
    } finally { setLoading(false); }
  }

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
    } finally { setLoading(false); }
  }

  /** ========== FIAT ON-RAMPS ========== */
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
      // You can pass wallet address to prefill
      walletAddress: account || "",
      isFeeCalculationHidden: "true",
      hideMenu: "true",
      themeColor: "5a4126", // desert-ish
      defaultNetwork: "base", // change if needed
    });

    window.open(`${base}?${params.toString()}`, "_blank", "noopener,noreferrer");
  }

  /** ========== ADMIN ========== */
  async function adminSetPrice() {
    try {
      if (!isOwner) throw new Error("Not owner");
      const value = (adminPriceUSDT6 || "").trim();
      if (!/^\d+$/.test(value)) throw new Error("Enter integer price (USDT 6dp)");
      const signer = await getSigner();
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
      const signer = await getSigner();
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
      const signer = await getSigner();
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
      const signer = await getSigner();
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

  /** ---------- UI ---------- */
  return (
    <div
      className="app"
      style={{
        minHeight: "100vh",
        padding: 24,
        color: "#fff",
        background: "transparent",
      }}
    >
      {/* Top bar */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 16, flexWrap: "wrap" }}>
        <button onClick={connect} disabled={isConnected} style={{ padding: "10px 14px", borderRadius: 8 }}>
          {isConnected ? "Wallet Connected" : "Connect Wallet"}
        </button>
        <div style={{ fontSize: 12, opacity: 0.85 }}>
          {account ? `Acct: ${account.slice(0, 6)}…${account.slice(-4)}` : "Not connected"}
          {chainId ? ` • ChainID: ${chainId}` : ""}
        </div>

        {/* Fiat on-ramps */}
        <div style={{ marginLeft: "auto", display: "flex", gap: 8 }}>
          <button onClick={openCoinbaseCheckout} style={{ padding: "8px 12px", borderRadius: 8 }}>
            💳 Buy with Card (Coinbase)
          </button>
          <button onClick={openTransak} style={{ padding: "8px 12px", borderRadius: 8 }}>
            🌐 Buy with Card (Transak)
          </button>
        </div>
      </div>

      <div style={{ display: "grid", gap: 16 }}>
        {/* ETH */}
        <section style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Buy with ETH</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              type="text"
              inputMode="decimal"
              placeholder="ETH amount (e.g. 0.01)"
              value={ethAmount}
              onChange={(e) => setEthAmount(e.target.value)}
              style={{ flex: 1, minWidth: 200, padding: 10, borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)" }}
            />
            <button onClick={handleBuyETH} disabled={loading} style={{ padding: "10px 14px", borderRadius: 8 }}>
              Buy
            </button>
          </div>
        </section>

        {/* USDT */}
        <section style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Buy with USDT</h3>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <input
              type="text"
              inputMode="decimal"
              placeholder={`USDT amount (${USDT_DECIMALS} dp)`}
              value={usdtAmount}
              onChange={(e) => setUsdtAmount(e.target.value)}
              style={{ flex: 1, minWidth: 200, padding: 10, borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)" }}
            />
            <button onClick={handleBuyUSDT} disabled={loading} style={{ padding: "10px 14px", borderRadius: 8 }}>
              Buy
            </button>
          </div>
        </section>

        {/* SMART */}
        <section style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 16 }}>
          <h3 style={{ marginTop: 0 }}>Smart Buy by SQ8 amount</h3>
          <div style={{ display: "grid", gap: 8 }}>
            <div>Price (USDT 6dp / SQ8): <b>{priceUSDT6.toString()}</b></div>
            <div>ETH USD (6dp): <b>{ethUsd6.toString()}</b></div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <input
                type="text"
                inputMode="decimal"
                placeholder="Desired SQ8 amount"
                value={desiredTokens}
                onChange={(e) => setDesiredTokens(e.target.value)}
                style={{ flex: 1, minWidth: 200, padding: 10, borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)" }}
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

        {/* ADMIN (visible for owner only) */}
        {isOwner && (
          <section style={{ background: "rgba(30,20,10,0.55)", border: "1px solid rgba(255,255,255,0.18)", borderRadius: 12, padding: 16 }}>
            <h3 style={{ marginTop: 0 }}>Admin Panel</h3>
            <div style={{ display: "grid", gap: 10 }}>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  type="text"
                  inputMode="numeric"
                  placeholder="New priceUSDT6 (integer)"
                  value={adminPriceUSDT6}
                  onChange={(e) => setAdminPriceUSDT6(e.target.value)}
                  style={{ flex: 1, minWidth: 200, padding: 10, borderRadius: 8, border: "1px solid rgba(255,255,255,0.15)" }}
                />
                <button onClick={adminSetPrice} style={{ padding: "10px 14px", borderRadius: 8 }}>
                  Set Price
                </button>
              </div>

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
            <div style={{ fontSize: 12, opacity: 0.8, marginTop: 8 }}>
              Only visible when connected wallet equals <code>{OWNER_ADDRESS || "(VITE_OWNER_ADDRESS not set)"}</code>
            </div>
          </section>
        )}

        {!!txStatus && (
          <div style={{ background: "rgba(0,0,0,0.4)", border: "1px solid rgba(255,255,255,0.12)", borderRadius: 12, padding: 12, fontSize: 14 }}>
            {txStatus}
          </div>
        )}
      </div>
    </div>
  );
}
