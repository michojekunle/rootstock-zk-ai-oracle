/**
 * config.js
 *
 * Configuration for the ZK Oracle dApp.
 *
 * Update the ORACLE_ADDRESS values after deploying to testnet/mainnet.
 * Get the addresses from:
 *   1. Local: deployments.json after npm run deploy:local
 *   2. Testnet: deployments.json after npm run deploy:testnet
 */

export default {
  // Contract addresses (update after deployment)
  ORACLE_ADDRESS: {
    31337: "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",  // Local hardhat
    31: "0x...",                                          // Rootstock testnet (TODO: update after deployment)
    30: "0x...",                                          // Rootstock mainnet (TODO: update after deployment)
  },

  // RPC endpoints
  RPC_URLS: {
    31337: "http://127.0.0.1:8545",
    31: "https://public-node.testnet.rsk.co",
    30: "https://public-node.rsk.co",
  },

  // Network names
  CHAIN_NAMES: {
    31337: "Hardhat Local",
    31: "Rootstock Testnet",
    30: "Rootstock Mainnet",
  },

  // Supported networks (can connect to either local or testnet)
  SUPPORTED_CHAINS: [31337, 31, 30],

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
