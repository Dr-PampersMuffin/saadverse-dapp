// src/constants.ts

export const ACTIVE_CHAIN = {
  id: Number(import.meta.env.VITE_ACTIVE_CHAIN_ID) || 8453,
  name: import.meta.env.VITE_ACTIVE_CHAIN_NAME || "Base",
  rpcUrl: import.meta.env.VITE_RPC_URL || "https://mainnet.base.org",
  blockExplorer: import.meta.env.VITE_BLOCK_EXPLORER || "https://basescan.org",
};

export const PRESALE_ADDRESS =
  import.meta.env.VITE_PRESALE_ADDRESS || "0x00ab2677723295F2d0A79cb68E1893f9707B409D";

export const USDT_ADDRESS =
  import.meta.env.VITE_USDT_ADDRESS || "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2";

export const SAAD_ADDRESS =
  import.meta.env.VITE_SAAD_ADDRESS || "0x3120B918b65613fC709272E26938352229c2E597";

// On-ramp configs
export const TRANSAK_ENV_URL =
  import.meta.env.VITE_TRANSAK_ENV_URL || "https://global.transak.com";

export const TRANSAK_API_KEY =
  import.meta.env.VITE_TRANSAK_API_KEY || "905b840d-5e5b-4ab8-8610-cb227636e3e6";

export const COINBASE_CHECKOUT_ID =
  import.meta.env.VITE_COINBASE_CHECKOUT_ID || "37570fdf-7968-4d67-a4d6-9ffa4c4b77dd";



























