// hardhat.config.cjs
// Must be .cjs (not .js) because package.json has "type": "module"
// Hardhat's config loader uses require(), so this file stays CommonJS.

require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const PRIVATE_KEY = process.env.PRIVATE_KEY || "0x" + "0".repeat(64);

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
      // viaIR can help with large verifier contracts
      // viaIR: true,
    },
  },

  networks: {
    // ── Local development ─────────────────────────────────────────────────
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337,
    },

    // ── Rootstock Testnet ─────────────────────────────────────────────────
    // Chain ID: 31 | Currency: tRBTC | Faucet: https://faucet.rootstock.io
    // Uses Bitcoin merged mining — every block is anchored to BTC hashrate.
    // Block time: ~30 seconds (much slower than Ethereum, adjust timeout)
    rskTestnet: {
      url: process.env.RSK_RPC_URL || "https://public-node.testnet.rsk.co",
      chainId: 31,
      accounts: [PRIVATE_KEY],
      // Rootstock minimum gas price: 0.06 gwei (60,000,000 wei)
      gasPrice: 60000000,
      // Groth16 verifyProof uses ~350k-450k gas (ecpairing precompile)
      gas: 6800000,
      // Rootstock block time ~30s — increase timeout to avoid false failures
      timeout: 120000,
    },

    // ── Rootstock Mainnet ─────────────────────────────────────────────────
    // Chain ID: 30 | Currency: RBTC (1:1 peg with BTC)
    rskMainnet: {
      url: "https://public-node.rsk.co",
      chainId: 30,
      accounts: [PRIVATE_KEY],
      gasPrice: 60000000,
      gas: 6800000,
      timeout: 120000,
    },
  },

  paths: {
    sources: "./contracts",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },

  // Gas reporter (optional — prints gas usage table after tests)
  gasReporter: {
    enabled: process.env.REPORT_GAS !== undefined,
    currency: "USD",
  },
};
