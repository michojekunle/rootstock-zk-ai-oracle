// agent/index.js
// ─────────────────────────────────────────────────────────────────────────────
// ZK-Private AI Oracle Agent
// Combines: MCP Server + TinyLlama Predictor + Circom ZK Proof + Oracle Submission
//
// This agent can be used in two ways:
//   1. As an MCP server (connected to Claude or another MCP host via stdio)
//   2. As a standalone CLI script (direct pipeline execution)
//
// MCP Tools exposed:
//   predict_btc_yield    — Run TinyLlama prediction on live CoinGecko BTC data
//   generate_zk_proof    — Generate a Groth16 ZK proof for a prediction
//   submit_to_oracle     — Submit proof to Oracle.sol on Rootstock
//   run_full_pipeline    — Run all three steps automatically
//
// Standalone CLI:
//   node agent/index.js                           (local hardhat node, threshold 500)
//   node agent/index.js --network local           (explicit local — same as default)
//   node agent/index.js --network testnet         (Rootstock testnet via RSK_RPC_URL or public node)
//   node agent/index.js --threshold 600           (custom threshold, local node)
//   node agent/index.js --network testnet --threshold 600
//   node agent/index.js --mcp                     (start as MCP server)
// ─────────────────────────────────────────────────────────────────────────────

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ethers } from "ethers";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { generateProof } from "../scripts/generateProof.js";
import { LlamaModel, LlamaContext, LlamaChatSession, ChatMLChatPromptWrapper } from "node-llama-cpp";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

// Load .env file (PRIVATE_KEY, RSK_RPC_URL, etc.)
// dotenv ESM import — silently skip if .env doesn't exist
try {
  const { default: dotenv } = await import("dotenv");
  dotenv.config({ path: path.join(ROOT, ".env") });
} catch (_) { /* dotenv not installed or .env missing — env vars still read from process.env */ }

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 1: TinyLlama BTC Yield Predictor + Real Market Data
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Fetch a single URL with a timeout. Retries once on transient failure.
 *
 * @param {string} url
 * @param {number} timeoutMs
 * @returns {Promise<Response>}
 */
async function fetchWithRetry(url, timeoutMs = 10000) {
  const attempt = async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      return res;
    } catch (err) {
      const reason = err.cause ? ` (${err.cause.message ?? err.cause})` : "";
      throw new Error(`Request to ${url} failed: ${err.message}${reason}`);
    } finally {
      clearTimeout(timer);
    }
  };

  try {
    return await attempt();
  } catch (firstErr) {
    console.log(`  [Data] Retrying after: ${firstErr.message}`);
    return attempt();
  }
}

/**
 * Fetch last 7 daily periods of BTC market data from CoinGecko (no API key required).
 * Returns price, volume, daily volatility, and BTC dominance for each period.
 *
 * @returns {Promise<Array<{price: number, volume: number, volatility: number, dominance: number}>>}
 */
async function fetchBtcHistory() {
  console.log("  [Data] Fetching live BTC market data from CoinGecko...");

  // Fetch 8 days so we can compute 7 volatility values from consecutive pairs
  const [chartRes, globalRes] = await Promise.all([
    fetchWithRetry(
      "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart" +
      "?vs_currency=usd&days=8&interval=daily"
    ),
    fetchWithRetry("https://api.coingecko.com/api/v3/global"),
  ]);

  if (!chartRes.ok) {
    throw new Error(
      `CoinGecko chart API error: HTTP ${chartRes.status} ${chartRes.statusText}\n` +
      "If this persists, check https://status.coingecko.com or set a COINGECKO_API_KEY in .env"
    );
  }
  if (!globalRes.ok) {
    throw new Error(
      `CoinGecko global API error: HTTP ${globalRes.status} ${globalRes.statusText}`
    );
  }

  const chart = await chartRes.json();
  const { data: globalData } = await globalRes.json();

  const btcDominance = globalData.market_cap_percentage.btc;
  const { prices, total_volumes } = chart;

  const len = Math.min(prices.length, total_volumes.length);
  if (len < 2) {
    throw new Error(`Insufficient CoinGecko data: only ${len} data points returned`);
  }

  const history = [];
  for (let i = 1; i < len; i++) {
    const price      = prices[i][1];
    const prevPrice  = prices[i - 1][1];
    const volume     = total_volumes[i][1];
    const volatility = Math.abs(price - prevPrice) / prevPrice;
    history.push({ price, volume, volatility, dominance: btcDominance });
  }

  const result = history.slice(-7);
  console.log(`  [Data] Fetched ${result.length} periods. Latest BTC price: $${Math.round(result[result.length - 1].price).toLocaleString()}`);
  return result;
}

// Singleton LlamaChatSession — loaded once on first call to llamaPredict()
let _session = null;

/**
 * Initialise (or return cached) LlamaChatSession using TinyLlama.
 * Model path: LLAMA_MODEL_PATH env var or ./models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf
 *
 * @returns {Promise<LlamaChatSession>}
 */
async function loadSession() {
  if (_session !== null) return _session;

  const modelPath = process.env.LLAMA_MODEL_PATH
    ?? path.join(ROOT, "models", "tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf");

  if (!existsSync(modelPath)) {
    throw new Error(
      `LLM model not found: ${modelPath}\n` +
      "Set LLAMA_MODEL_PATH to the .gguf file path or place the model in ./models/"
    );
  }

  console.log(`  [Llama] Loading model: ${modelPath}`);
  const model   = new LlamaModel({ modelPath });
  const context = new LlamaContext({ model });
  _session = new LlamaChatSession({
    context,
    promptWrapper: new ChatMLChatPromptWrapper(),
    systemPrompt:
      "You are a DeFi yield prediction model. " +
      "Output only a single integer from 0 to 10000 (basis points, where 100 = 1% APY). " +
      "No text, no units, no explanation — just the integer.",
  });

  return _session;
}

/**
 * Run TinyLlama inference on real BTC market data to predict DeFi lending yield.
 *
 * @param {Array<{price: number, volume: number, volatility: number, dominance: number}>} btcHistory
 * @returns {Promise<number>} Predicted yield in basis points [0, 10000]
 */
async function llamaPredict(btcHistory) {
  const session = await loadSession();

  const compactData = btcHistory.map(d => ({
    price:      Math.round(d.price),
    volume:     Math.round(d.volume),
    volatility: +d.volatility.toFixed(4),
    dominance:  +d.dominance.toFixed(1),
  }));

  const prompt =
    "Predict the expected BTC DeFi lending yield in basis points " +
    "given this 7-period market data:\n" +
    JSON.stringify(compactData);

  console.log("  [Llama] Running inference on live market data...");
  const response = await session.prompt(prompt, { temperature: 0.1, maxTokens: 16 });
  const trimmed  = response.trim();

  const match = trimmed.match(/\b(\d{1,5})\b/);
  const value = match ? parseInt(match[1], 10) : NaN;

  if (isNaN(value) || value < 0 || value > 10000) {
    throw new Error(`LLM returned unparseable yield: "${trimmed}"`);
  }

  console.log(`  [Llama] Raw response:    "${trimmed}"`);
  console.log(`  [Llama] Predicted yield: ${value} bps (${(value / 100).toFixed(2)}%)`);

  return value;
}

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 2: Oracle Contract Interaction (ethers.js)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolve the RPC URL for the target network.
 * Defaults to local hardhat node if network is unspecified or "local".
 *
 * @param {"local"|"testnet"|undefined} network
 * @returns {string} RPC URL
 */
function resolveRpcUrl(network) {
  if (network === "testnet") {
    return process.env.RSK_RPC_URL || "https://public-node.testnet.rsk.co";
  }
  return "http://127.0.0.1:8545";
}

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
 * @param {string} rpcUrl RPC endpoint resolved by resolveRpcUrl()
 * @returns {Promise<import("ethers").TransactionReceipt>}
 */
async function submitToOracle(solidityCalldata, rpcUrl) {
  const deployment = loadDeployment();
  const abi = loadOracleABI();

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
  "Use TinyLlama to predict BTC DeFi yield from live CoinGecko market data. " +
  "Returns a yield in basis points (0-10000) that will be kept private in the ZK proof.",
  {
    threshold: z.number().int().min(0).max(10000).default(500)
      .describe("Yield threshold in basis points for above/below comparison (default 500 = 5%)"),
  },
  async ({ threshold }) => {
    console.log("\n[Tool: predict_btc_yield]");
    console.log("  Fetching live BTC market data and running TinyLlama inference...");

    const prediction = await llamaPredict(await fetchBtcHistory());

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
    network: z.enum(["local", "testnet"]).default("local")
      .describe("Target network: 'local' (hardhat, default) or 'testnet' (Rootstock testnet)"),
  },
  async ({ pA, pB, pC, pubSignals, network }) => {
    console.log("\n[Tool: submit_to_oracle]");

    try {
      const receipt = await submitToOracle({ pA, pB, pC, pubSignals }, resolveRpcUrl(network));

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
    network: z.enum(["local", "testnet"]).default("local")
      .describe("Target network: 'local' (hardhat, default) or 'testnet' (Rootstock testnet)"),
  },
  async ({ threshold, network }) => {
    return runFullPipeline(threshold, resolveRpcUrl(network));
  }
);

// ═══════════════════════════════════════════════════════════════════════════════
// SECTION 4: Full Pipeline (shared by MCP tool and CLI mode)
// ═══════════════════════════════════════════════════════════════════════════════

async function runFullPipeline(threshold = 500, rpcUrl = "http://127.0.0.1:8545") {
  console.log("");
  console.log("╔══════════════════════════════════════════════════╗");
  console.log("║  ZK-Private AI Oracle — Full Pipeline            ║");
  console.log("╚══════════════════════════════════════════════════╝");
  console.log(`  Network: ${rpcUrl}`);

  try {
    // ── Step 1: TinyLlama Prediction on Live Data ────────────────────────────
    console.log("\n[Step 1/3] AI Yield Prediction (TinyLlama + Live CoinGecko Data)");
    console.log("─".repeat(50));
    const rawPrediction = await llamaPredict(await fetchBtcHistory());
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
    const receipt = await submitToOracle(solidityCalldata, rpcUrl);

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

    const detail = err.cause ? `\n  Caused by: ${err.cause}` : "";
    console.error(`\nPipeline failed: ${err.message}${detail}`);
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
  const threshold = thresholdIdx !== -1 ? parseInt(args[thresholdIdx + 1], 10) : 500;

  const networkIdx = args.indexOf("--network");
  const network = networkIdx !== -1 ? args[networkIdx + 1] : "local";

  if (network !== "local" && network !== "testnet") {
    console.error(`Unknown network "${network}". Use --network local or --network testnet`);
    process.exit(1);
  }

  const rpcUrl = resolveRpcUrl(network);

  runFullPipeline(threshold, rpcUrl).then((result) => {
    if (result.isError) {
      process.exit(1);
    }
  }).catch((err) => {
    console.error("Unhandled error:", err.message);
    process.exit(1);
  });
}
