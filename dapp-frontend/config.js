/**
 * config.js
 *
 * Configuration for the ZK Oracle dApp (Rootstock Testnet & Mainnet)
 *
 * UPDATE AFTER DEPLOYMENT:
 * After running `npm run deploy:testnet` or `npm run deploy:mainnet`,
 * copy the oracle address from deployments.json below:
 */

export default {
  // PRIMARY: Rootstock Testnet & Mainnet addresses
  ORACLE_ADDRESS: {
    31: "0x...",  // Rootstock testnet — set after npm run deploy:testnet
    30: "0x...",  // Rootstock mainnet — set after npm run deploy:mainnet
    // Optional: Local hardhat development (chainId 31337) — set after npm run deploy:local
    // 31337: "0x...",
  },

  // RPC endpoints
  RPC_URLS: {
    31: "https://public-node.testnet.rsk.co",
    30: "https://public-node.rsk.co",
    // 31337: "http://127.0.0.1:8545",
  },

  // Network names
  CHAIN_NAMES: {
    31: "Rootstock Testnet",
    30: "Rootstock Mainnet",
    // 31337: "Hardhat Local",
  },

  // Supported networks (testnet + mainnet only; local is optional)
  SUPPORTED_CHAINS: [31, 30],

  // Strategy tiers (from Oracle.sol)
  STRATEGY_TIERS: {
    aggressive: {
      minYield: 800,
      color: "#10b981",
      description: "Yield ≥ 800 bps (≥ 8%): High confidence in BTC yield. Consider leveraged positions on Sovryn AMM or other high-yield DeFi protocols.",
    },
    balanced: {
      minYield: 500,
      color: "#3b82f6",
      description: "Yield ≥ 500 bps (≥ 5%): Moderate confidence. Good for standard lending strategies on Tropykus or Sovryn.",
    },
    conservative: {
      minYield: 200,
      color: "#f59e0b",
      description: "Yield ≥ 200 bps (≥ 2%): Lower confidence. Suitable for RBTC staking or other conservative yield strategies.",
    },
    idle: {
      minYield: 0,
      color: "#6b7280",
      description: "Yield < 200 bps (< 2%): Confidence is low. Better to hold RBTC and wait for improved market conditions.",
    },
  },
};
