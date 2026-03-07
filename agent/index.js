// agent/index.js
// ─────────────────────────────────────────────────────────────────────────────
// ZK-Private AI Oracle Agent
// Combines: MCP Server + Mock Llama Predictor + Circom ZK Proof + Oracle Submission
//
// This agent can be used in two ways:
//   1. As an MCP server (connected to Claude or another MCP host via stdio)
//   2. As a standalone CLI script (direct pipeline execution)
//
// MCP Tools exposed:
//   predict_btc_yield    — Run mock Llama prediction on BTC market data
//   generate_zk_proof    — Generate a Groth16 ZK proof for a prediction
//   submit_to_oracle     — Submit proof to Oracle.sol on Rootstock
//   run_full_pipeline    — Run all three steps automatically
//
// Standalone CLI:
//   node agent/index.js                      (runs full pipeline with defaults)
//   node agent/index.js --threshold 600      (custom threshold)
//   node agent/index.js --mcp               (start as MCP server)
// ─────────────────────────────────────────────────────────────────────────────

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ethers } from "ethers";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { generateProof } from "../scripts/generateProof.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Load .env file (PRIVATE_KEY, RSK_RPC_URL, etc.)
// dotenv ESM import — silently skip if .env doesn't exist
try {
  const { default: dotenv } = await import("dotenv");
  dotenv.config({ path: path.join(ROOT, ".env") });
} catch (_) { /* dotenv not installed or .env missing — env vars still read from process.env */ }

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: Mock Llama BTC Yield Predictor
//
// In production, replace mockLlamaPredict() with real LLM inference.
// Integration guide (node-llama-cpp):
//
//   import { getLlama, LlamaChatSession } from "node-llama-cpp";
//
//   const llama = await getLlama();
//   const model = await llama.loadModel({
//     modelPath: process.env.LLAMA_MODEL_PATH || "./models/llama-3.2-3b.gguf"
//   });
//   const context = await model.createContext();
//   const session = new LlamaChatSession({
//     contextSequence: context.getSequence()
//   });
//
//   const prompt = `
//     You are a BTC yield prediction model. Given the following 24-hour BTC market data,
//     predict the expected DeFi lending yield in basis points (0-10000, where 100 = 1%).
//     Return ONLY a single integer. No explanation.
//
//     Market data: ${JSON.stringify(btcHistory)}
//   `;
//   const response = await session.prompt(prompt);
//   return Math.max(0, Math.min(10000, parseInt(response.trim())));
//
// Download model: npx node-llama-cpp pull --dir ./models llama3.2:3b
// ═══════════════════════════════════════════════════════════════════════════════

// Synthetic BTC market history (7 data points = last 7 periods)
// In production: fetch from CoinGecko, Binance, or RSK DeFi protocols
const MOCK_BTC_HISTORY = [
  { price: 42000, volume: 18000, volatility: 0.025, dominance: 52.1 },
  { price: 44500, volume: 21000, volatility: 0.018, dominance: 52.8 },
  { price: 43200, volume: 16000, volatility: 0.031, dominance: 51.9 },
  { price: 46000, volume: 25000, volatility: 0.012, dominance: 53.2 },
  { price: 45500, volume: 22000, volatility: 0.015, dominance: 53.0 },
  { price: 47200, volume: 28000, volatility: 0.009, dominance: 54.1 },
  { price: 48900, volume: 31000, volatility: 0.008, dominance: 55.0 },
];

/**
 * Mock Llama yield predictor.
 * Simulates LLM reasoning about BTC market conditions to predict DeFi yield.
 *
 * Factors considered (mirroring how a real LLM would reason):
 *   - Price momentum: rising BTC → improved lending conditions
 *   - Volume surge: high volume → higher confidence, better market depth
 *   - Volatility: high volatility → risk-off, lower yields
 *   - BTC dominance: higher dominance → stronger BTC narrative → better yield
 *
 * @param {Object[]} btcHistory - Array of BTC market data points
 * @returns {number} Predicted yield in basis points (0-10000)
 */
function mockLlamaPredict(btcHistory) {
  const latest = btcHistory[btcHistory.length - 1];
  const prev   = btcHistory[btcHistory.length - 2];

  // Price momentum factor (positive = bullish trend)
  const priceMomentum = (latest.price - prev.price) / prev.price;

  // Volume factor (1.0 = average, >1.0 = elevated activity)
  const avgVolume = btcHistory.reduce((s, d) => s + d.volume, 0) / btcHistory.length;
  const volumeFactor = latest.volume / avgVolume;

  // Volatility penalty (high volatility reduces yield confidence)
  const volatilityPenalty = latest.volatility * 1500;

  // Dominance bonus (higher BTC dominance = market favors BTC DeFi)
  const dominanceBonus = (latest.dominance - 50) * 25;

  // Base yield: 400 bps (4%) — typical RSK lending baseline
  const baseYield = 400;

  // Composite score
  const rawScore =
    baseYield
    + priceMomentum * 6000    // momentum has strong impact
    + (volumeFactor - 1) * 150 // volume boost
    - volatilityPenalty        // volatility is a drag
    + dominanceBonus;          // dominance bonus

  // Clamp to valid circuit range [0, 10000]
  const prediction = Math.max(0, Math.min(10000, Math.round(rawScore)));

  console.log("  [Llama] BTC price momentum: " + (priceMomentum * 100).toFixed(2) + "%");
  console.log("  [Llama] Volume factor:       " + volumeFactor.toFixed(2) + "x");
  console.log("  [Llama] Volatility penalty:  " + volatilityPenalty.toFixed(1) + " bps");
  console.log("  [Llama] Dominance bonus:     " + dominanceBonus.toFixed(1) + " bps");
  console.log(`  [Llama] Predicted yield:     ${prediction} bps (${(prediction / 100).toFixed(2)}%)`);

  return prediction;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: Oracle Contract Interaction (ethers.js)
// ═══════════════════════════════════════════════════════════════════════════════

function loadDeployment() {
  const deployPath = path.join(ROOT, "deployments.json");
  if (!existsSync(deployPath)) {
    throw new Error(
      "deployments.json not found.\n" +
      "Run one of:\n" +
      "  npm run deploy:local     (local hardhat node)\n" +
      "  npm run deploy:testnet   (Rootstock testnet)"
    );
  }
  return JSON.parse(readFileSync(deployPath, "utf-8"));
}

function loadOracleABI() {
  const abiPath = path.join(
    ROOT, "artifacts", "contracts", "Oracle.sol", "Oracle.json"
  );
  if (!existsSync(abiPath)) {
    throw new Error(
      "Oracle artifact not found. Run: npm run compile:contracts"
    );
  }
  return JSON.parse(readFileSync(abiPath, "utf-8")).abi;
}

/**
 * Submit a ZK proof to the deployed Oracle contract.
 *
 * @param {{ pA, pB, pC, pubSignals }} solidityCalldata Formatted proof from generateProof
 * @returns {Promise<import("ethers").TransactionReceipt>}
 */
async function submitToOracle(solidityCalldata) {
  const deployment = loadDeployment();
  const abi = loadOracleABI();

  const rpcUrl = process.env.RSK_RPC_URL || "http://127.0.0.1:8545";
  const privateKey = process.env.PRIVATE_KEY;

  const provider = new ethers.JsonRpcProvider(rpcUrl);
  let signer;

  // For local hardhat testing, auto-use the first account (has 10000 test RBTC)
  if (rpcUrl.includes("127.0.0.1") || rpcUrl.includes("localhost")) {
    console.log("  [Chain] Detected local hardhat node - using first test account");
    const accounts = await provider.listAccounts();
    if (!accounts.length) {
      throw new Error("No accounts found on hardhat node. Is `npx hardhat node` running?");
    }
    signer = accounts[0];
  } else if (privateKey) {
    // For testnet/mainnet, use provided private key
    signer = new ethers.Wallet(privateKey, provider);
  } else {
    throw new Error(
      "PRIVATE_KEY not set in .env and not on local hardhat\n" +
      "For testnet: add PRIVATE_KEY to .env"
    );
  }

  const oracle   = new ethers.Contract(deployment.oracle, abi, signer);

  const { pA, pB, pC, pubSignals } = solidityCalldata;

  console.log(`  [Chain] Oracle address: ${deployment.oracle}`);
  console.log(`  [Chain] Network RPC:    ${rpcUrl}`);
  console.log(`  [Chain] Submitter:      ${signer.address}`);

  // DEBUG: Show public signals being submitted
  console.log(`  [Chain] Public signals (${pubSignals.length}): ${JSON.stringify(pubSignals)}`);

  // ── Gas estimation ─────────────────────────────────────────────────────────
  // Groth16 verifyProof uses ~350k-450k gas via ecpairing precompile (0x08).
  // Gas estimation will FAIL if the proof is invalid — this catches errors early.
  let gasEstimate;
  try {
    gasEstimate = await oracle.submitPrediction.estimateGas(pA, pB, pC, pubSignals);
    console.log(`  [Chain] Gas estimate:   ${gasEstimate.toString()} units`);
  } catch (err) {
    // Parse revert reason for better error messages
    if (err.message.includes("InvalidProof")) {
      throw new Error("On-chain proof verification failed (InvalidProof).\n" +
        "Ensure you are using the real Verifier.sol (from npm run compile:circuit).");
    }
    throw new Error(`Gas estimation failed: ${err.message}`);
  }

  // Add 20% buffer to gas limit for safety
  const gasLimit = (gasEstimate * 120n) / 100n;

  // ── Submit transaction ─────────────────────────────────────────────────────
  // Detect if we're on hardhat (chainId 31337) and use appropriate fee structure
  const chainId = (await provider.getNetwork()).chainId;
  const isLocalHardhat = chainId === 31337n || rpcUrl.includes("127.0.0.1") || rpcUrl.includes("localhost");

  let txOptions = { gasLimit };

  if (isLocalHardhat) {
    // For hardhat's EIP-1559: use dynamic fees based on current block
    const feeData = await provider.getFeeData();
    txOptions.maxPriorityFeePerGas = feeData.maxPriorityFeePerGas || 1000000000n; // 1 gwei fallback
    txOptions.maxFeePerGas = (feeData.maxFeePerGas || 2000000000n);
  } else {
    // For Rootstock testnet: use fixed gas price (0.06 gwei minimum)
    txOptions.gasPrice = 60000000n;
  }

  const tx = await oracle.submitPrediction(pA, pB, pC, pubSignals, txOptions);

  console.log(`  [Chain] Transaction:    ${tx.hash}`);
  console.log("  [Chain] Waiting for confirmation (~30s on Rootstock)...");

  // Wait for 1 block confirmation
  // Rootstock block time is ~30 seconds; Hardhat is instant
  const receipt = await tx.wait(1);

  console.log(`  [Chain] Block:          ${receipt.blockNumber}`);
  console.log(`  [Chain] Gas used:       ${receipt.gasUsed.toString()} units`);
  console.log(`  [Chain] Status:         ${receipt.status === 1 ? "SUCCESS" : "FAILED"}`);

  if (receipt.status !== 1) {
    throw new Error(`Transaction failed (status=0). Hash: ${receipt.hash}`);
  }

  // ── Parse events ──────────────────────────────────────────────────────────
  const iface = new ethers.Interface(abi);
  for (const log of receipt.logs) {
    try {
      const parsed = iface.parseLog({ topics: log.topics, data: log.data });
      if (parsed && parsed.name === "PredictionSubmitted") {
        console.log("  [Chain] Event PredictionSubmitted:");
        console.log(`    predictionId:     ${parsed.args[0]}`);
        console.log(`    predictedYield:   ${parsed.args[1]} bps`);
        console.log(`    isAboveThreshold: ${parsed.args[2]}`);
        console.log(`    threshold:        ${parsed.args[3]} bps`);
        console.log(`    submitter:        ${parsed.args[4]}`);
      }
    } catch (_) { /* skip non-Oracle logs */ }
  }

  return receipt;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 3: MCP Server Definition
// ═══════════════════════════════════════════════════════════════════════════════

const server = new McpServer({
  name: "rootstock-zk-ai-oracle",
  version: "1.0.0",
  description: "ZK-private AI yield oracle on Rootstock — predict, prove, submit",
});

// ── Tool 1: predict_btc_yield ─────────────────────────────────────────────────
server.tool(
  "predict_btc_yield",
  "Use the mock Llama model to predict BTC DeFi yield from historical market data. " +
  "Returns a yield in basis points (0-10000) that will be kept private in the ZK proof.",
  {
    threshold: z.number().int().min(0).max(10000).default(500)
      .describe("Yield threshold in basis points for above/below comparison (default 500 = 5%)"),
  },
  async ({ threshold }) => {
    console.log("\n[Tool: predict_btc_yield]");
    console.log("  Running mock Llama prediction on BTC history...");

    const prediction = mockLlamaPredict(MOCK_BTC_HISTORY);

    return {
      content: [{
        type: "text",
        text: JSON.stringify({
          predictedYield:   prediction,
          yieldPercent:     (prediction / 100).toFixed(2) + "%",
          isAboveThreshold: prediction >= threshold,
          threshold,
          note: "This raw prediction is PRIVATE — it will not be revealed on-chain.",
        }, null, 2),
      }],
    };
  }
);

// ── Tool 2: generate_zk_proof ─────────────────────────────────────────────────
server.tool(
  "generate_zk_proof",
  "Generate a Groth16 ZK proof for an AI yield prediction. " +
  "The proof reveals predicted_yield and is_above_threshold publicly, while keeping raw_prediction and salt private.",
  {
    rawPrediction: z.number().int().min(0).max(10000)
      .describe("The AI prediction to prove in [0, 10000] basis points (kept private)"),
    threshold: z.number().int().min(0).max(10000).default(500)
      .describe("Public threshold for comparison"),
    salt: z.number().int().min(0).optional()
      .describe("Privacy salt (auto-generated if not provided)"),
  },
  async ({ rawPrediction, threshold, salt }) => {
    console.log("\n[Tool: generate_zk_proof]");

    const actualSalt = salt ?? Math.floor(Math.random() * 1e14);

    try {
      const result = await generateProof({ rawPrediction, salt: actualSalt, threshold });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: true,
            publicSignals:    result.publicSignals,
            solidityCalldata: result.solidityCalldata,
            note: "Use solidityCalldata to call Oracle.submitPrediction()",
          }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success: false,
            error: err.message,
            hint: err.message.includes("not found") ? "Run: npm run compile:circuit" : undefined,
          }, null, 2),
        }],
        isError: true,
      };
    }
  }
);

// ── Tool 3: submit_to_oracle ──────────────────────────────────────────────────
server.tool(
  "submit_to_oracle",
  "Submit a ZK proof to the Oracle contract on Rootstock. " +
  "Requires a funded wallet (PRIVATE_KEY in .env) and deployed contract (deployments.json).",
  {
    pA: z.array(z.string()).length(2)
      .describe("Proof element A: [x, y] as hex strings"),
    pB: z.array(z.array(z.string()).length(2)).length(2)
      .describe("Proof element B: [[x1,y1],[x2,y2]] as hex strings"),
    pC: z.array(z.string()).length(2)
      .describe("Proof element C: [x, y] as hex strings"),
    pubSignals: z.array(z.string()).length(3)
      .describe("Public signals: [predicted_yield, is_above_threshold, threshold]"),
  },
  async ({ pA, pB, pC, pubSignals }) => {
    console.log("\n[Tool: submit_to_oracle]");

    try {
      const receipt = await submitToOracle({ pA, pB, pC, pubSignals });

      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            success:     true,
            txHash:      receipt.hash,
            blockNumber: receipt.blockNumber,
            gasUsed:     receipt.gasUsed.toString(),
          }, null, 2),
        }],
      };
    } catch (err) {
      return {
        content: [{
          type: "text",
          text: JSON.stringify({ success: false, error: err.message }, null, 2),
        }],
        isError: true,
      };
    }
  }
);

// ── Tool 4: run_full_pipeline ─────────────────────────────────────────────────
server.tool(
  "run_full_pipeline",
  "Run the complete ZK oracle pipeline: predict → prove → submit. " +
  "Requires compiled circuit (npm run compile:circuit) and deployed contract.",
  {
    threshold: z.number().int().min(0).max(10000).default(500)
      .describe("Yield threshold in basis points"),
  },
  async ({ threshold }) => {
    return runFullPipeline(threshold);
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: Full Pipeline (shared by MCP tool and CLI mode)
// ═══════════════════════════════════════════════════════════════════════════════

async function runFullPipeline(threshold = 500) {
  console.log("");
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  ZK-Private AI Oracle — Full Pipeline            ║");
  console.log("╚══════════════════════════════════════════════════╝");

  try {
    // ── Step 1: Mock Llama Prediction ────────────────────────────────────────
    console.log("\n[Step 1/3] AI Yield Prediction (Mock Llama)");
    console.log("─".repeat(50));
    const rawPrediction = mockLlamaPredict(MOCK_BTC_HISTORY);
    const salt = Math.floor(Math.random() * 1e14);
    console.log(`  Raw prediction:  ${rawPrediction} bps (PRIVATE — never revealed on-chain)`);
    console.log(`  Salt:            ${salt} (random nonce for privacy binding)`);

    // ── Step 2: ZK Proof Generation ──────────────────────────────────────────
    console.log("\n[Step 2/3] ZK Proof Generation (Circom + snarkjs)");
    console.log("─".repeat(50));
    const { solidityCalldata, publicSignals } = await generateProof({
      rawPrediction,
      salt,
      threshold,
    });

    // ── Step 3: On-chain Submission ───────────────────────────────────────────
    console.log("\n[Step 3/3] On-chain Submission (Rootstock)");
    console.log("─".repeat(50));
    const receipt = await submitToOracle(solidityCalldata);

    // ── Summary ───────────────────────────────────────────────────────────────
    console.log("");
    console.log("╔══════════════════════════════════════════════════╗");
    console.log("║  Pipeline Complete!                              ║");
    console.log("╚══════════════════════════════════════════════════╝");

    const summary = {
      success: true,
      pipeline: {
        step1_prediction: {
          rawPrediction,
          visibility: "PRIVATE — not revealed on-chain",
        },
        step2_proof: {
          predictedYield:   publicSignals[0],
          isAboveThreshold: publicSignals[1] === "1",
          threshold:        publicSignals[2],
          visibility:       "PUBLIC — verified on-chain by Verifier.sol",
        },
        step3_submission: {
          txHash:      receipt.hash,
          blockNumber: receipt.blockNumber,
          gasUsed:     receipt.gasUsed.toString(),
        },
      },
      zkValueProp:
        "The AI model's raw output remains private while its correctness " +
        "is cryptographically proven via Groth16 ZK-SNARK. Bitcoin miners " +
        "secure the proof storage via Rootstock merged mining.",
    };

    console.log(JSON.stringify(summary, null, 2));

    return {
      content: [{ type: "text", text: JSON.stringify(summary, null, 2) }],
    };
  } catch (err) {
    const errorResult = {
      success: false,
      error: err.message,
      troubleshooting: [
        "Ensure npm run compile:circuit has been run",
        "Ensure npm run compile:contracts has been run",
        "Ensure contract is deployed (npm run deploy:local or deploy:testnet)",
        "Check PRIVATE_KEY is set in .env",
        "Check RSK_RPC_URL is accessible",
      ],
    };

    console.error("\nPipeline failed:", err.message);
    return {
      content: [{ type: "text", text: JSON.stringify(errorResult, null, 2) }],
      isError: true,
    };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 5: Entry Point (MCP server or CLI)
// ═══════════════════════════════════════════════════════════════════════════════

const isMCPMode = process.argv.includes("--mcp");

if (isMCPMode) {
  // ── MCP Server Mode ────────────────────────────────────────────────────────
  // Connect to MCP host (Claude, etc.) via stdio transport.
  // The host sends tool call requests; this server handles them.
  async function startMCPServer() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    // Use stderr for logs so stdout is clean for MCP protocol
    console.error("[MCP] ZK Oracle Agent server running on stdio");
    console.error("[MCP] Tools: predict_btc_yield, generate_zk_proof, submit_to_oracle, run_full_pipeline");
  }

  startMCPServer().catch((err) => {
    console.error("[MCP] Fatal error:", err.message);
    process.exit(1);
  });

} else {
  // ── CLI / Standalone Mode ──────────────────────────────────────────────────
  // Run the full pipeline directly without an MCP host.
  const args = process.argv.slice(2);
  const thresholdIdx = args.indexOf("--threshold");
  const threshold = thresholdIdx !== -1 ? parseInt(args[thresholdIdx + 1]) : 500;

  runFullPipeline(threshold).then((result) => {
    if (result.isError) {
      process.exit(1);
    }
  }).catch((err) => {
    console.error("Unhandled error:", err.message);
    process.exit(1);
  });
}
