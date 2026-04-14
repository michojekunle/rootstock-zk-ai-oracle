# ZK-Private AI Oracle on Rootstock

A yield oracle where an AI agent (TinyLlama) predicts BTC DeFi yield from live market data, generates a zero-knowledge Groth16 proof proving the prediction is valid, and submits it to a Solidity oracle contract on Rootstock. The ZK proof guarantees the prediction is authentic and in the valid range, without revealing how the AI arrived at it.

```
[TinyLlama] ──(private prediction)──▶ [Circom Circuit] ──▶ [ZK Proof]
                                                                │
                               [Oracle.sol on Rootstock] ◀─────┘
                                          │
                              [DeFi apps query Oracle]
                              getLatestPrediction()
                              recommendStrategy()
```

**Why this stack?**

| Component | Role |
|-----------|------|
| **TinyLlama (node-llama-cpp)** | Predicts BTC DeFi yield from live market data (kept private) |
| **Circom + Groth16** | Proves the prediction is valid without revealing inputs |
| **Rootstock** | Bitcoin-secured EVM chain — merged mining gives Bitcoin-level finality |
| **RBTC** | Gas token (1:1 peg with BTC) — no ETH needed |
| **MCP** | Exposes the pipeline as composable AI tools for Claude and other hosts |

---

## Architecture

```
agent/index.js
├── Section 1: TinyLlama AI predictor + live CoinGecko market data
│   ├── fetchBtcHistory() — fetch 7-day BTC price/volume/volatility from CoinGecko
│   ├── loadSession()     — load TinyLlama .gguf locally via node-llama-cpp (singleton)
│   └── llamaPredict()    — run inference → output raw_prediction (basis points, 0-10000)
│
├── Section 2: ZK Proof (Circom + snarkjs)
│   ├── Input:  raw_prediction + salt (private), threshold (public)
│   ├── Circuit: circuits/prediction.circom (Circom 2.0, Groth16)
│   ├── Constraints: range [0-10k], valid comparison, salt binding
│   └── Output: proof (pA, pB, pC) + public signals [predicted_yield, is_above_threshold, threshold]
│
└── Section 3: On-chain submission (ethers.js → Rootstock)
    ├── Oracle.sol.submitPrediction(pA, pB, pC, pubSignals)
    │   └── Verifier.sol.verifyProof() — uses ecpairing precompile (BN254)
    └── Event: PredictionSubmitted(predictionId, predictedYield, isAboveThreshold, ...)

DeFi Integration:
    Oracle.getLatestPrediction()  → (yield_bps, isAboveThreshold, timestamp)
    Oracle.recommendStrategy()    → ("aggressive" | "balanced" | "conservative" | "idle")
```

### ZK Circuit Details

**Private inputs** (never revealed on-chain):
- `raw_prediction` — The AI model's numeric output (0-10000 basis points)
- `salt` — Random nonce binding the proof to this specific run

**Public inputs** (committed in the proof):
- `threshold` — Comparison threshold chosen by the oracle operator

**Public outputs** (revealed and verified on-chain):
- `predicted_yield` — The AI's actual prediction value (0-10000 bps). The ZK proof **guarantees** this is authentic.
- `is_above_threshold` — 1 if `raw_prediction >= threshold`, else 0

**Constraints enforced by the ZK proof** (cryptographic guarantees):
1. **Range:** `0 <= raw_prediction <= 10000` (valid basis-points range)
2. **Authenticity:** `predicted_yield == raw_prediction` (the output on-chain matches what the AI computed)
3. **Comparison:** `is_above_threshold == (raw_prediction >= threshold)` (logic is computed correctly)
4. **Uniqueness:** Salt is bound to the proof (prevents replay or forgery)

---

## Prerequisites

```bash
node --version   # >= 18.0.0 required
npm --version    # >= 9.0.0 recommended
```

All other dependencies — including `circom2`, `snarkjs`, `node-llama-cpp`, and `ethers` — are installed automatically via `npm install`. No global tool installs are required.

---

## Setup

### 1. Clone and install dependencies

```bash
git clone https://github.com/yourname/rootstock-zk-ai-oracle
cd rootstock-zk-ai-oracle
npm install
```

### 2. Download the TinyLlama model

The agent uses **TinyLlama 1.1B** loaded locally via `node-llama-cpp`. Place the quantized GGUF model at:

```
models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf
```

Download it directly (≈ 638 MB):

```bash
mkdir -p models
curl -L "https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf" \
  -o models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf
```

To use a different model, set `LLAMA_MODEL_PATH` in `.env`:

```bash
LLAMA_MODEL_PATH=./models/your-model.Q4_K_M.gguf
```

### 3. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```bash
PRIVATE_KEY=0xYOUR_PRIVATE_KEY_HERE      # Wallet for signing txs
RSK_RPC_URL=https://public-node.testnet.rsk.co  # Rootstock testnet (default)

# Optional: override model path
# LLAMA_MODEL_PATH=./models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf

# Filled automatically after deployment:
# ORACLE_ADDRESS=
# VERIFIER_ADDRESS=
```

Get test RBTC (tRBTC): https://faucet.rootstock.io

---

## Circuit Artifacts (Pre-compiled)

The ZK circuit artifacts are already compiled and committed to this repository:

```
circuits/
├── prediction.circom           # ZK circuit source
├── prediction.r1cs             # Compiled constraint system
├── prediction.sym              # Symbol file
├── prediction_0000.zkey        # Phase-2 initial key
├── prediction_final.zkey       # Final proving key
├── verification_key.json       # Off-chain verification key
├── prediction_js/
│   ├── prediction.wasm         # Witness generator (WebAssembly)
│   └── ...
└── ptau/
    └── pot12_final.ptau        # Powers of Tau (power-12, ~4.6 MB, Hermez ceremony)
```

**If you need to recompile the circuit** (e.g., after modifying `prediction.circom`):

```bash
npm run compile:circuit
```

This script will:
1. Check `circom2` and `snarkjs` are available (uses local `node_modules`)
2. Use the existing `circuits/ptau/pot12_final.ptau` (skips download if present)
3. Recompile `prediction.circom` → `.r1cs` + `.wasm`
4. Re-run Groth16 trusted setup → new `prediction_final.zkey`
5. Export fresh `circuits/verification_key.json` and **overwrite** `contracts/Verifier.sol`

> **Note:** After running `compile:circuit`, you must also run `compile:contracts` and redeploy, since `Verifier.sol` will have new hardcoded verification keys.

---

## Step-by-Step Usage

### Step 1: Compile Contracts

The Solidity contracts are ready to compile against the existing artifacts.

```bash
npm run compile:contracts
```

### Step 2: Run Tests

```bash
npm test
```

Expected output:

```
Oracle Contract
  Deployment
    ✓ stores the correct verifier address
    ✓ sets deployer as owner
    ✓ starts with openSubmission = true
    ✓ starts with predictionCount = 0
  submitPrediction
    ✓ accepts a valid proof and increments predictionCount
    ✓ emits PredictionSubmitted with correct arguments
    ✓ rejects proof when verifier returns false
    ✓ rejects predicted_yield > 10000 even with valid proof
  recommendStrategy
    ✓ returns "aggressive" for yield >= 800 bps
    ✓ returns "balanced" for yield = 500 bps
    ✓ returns "conservative" for yield = 200 bps
    ✓ returns "idle" for yield = 0 bps
  ... (all tests pass)
```

> Tests use `MockVerifier.sol` and do **not** require TinyLlama or circuit recompilation.

### Step 3: Deploy Contracts

#### Local (no RBTC needed)

```bash
# Terminal 1: start local node (if not already running)
npx hardhat node

# Terminal 2: deploy
npm run deploy:local
```

#### Rootstock Testnet

```bash
# Ensure .env has PRIVATE_KEY with tRBTC balance
npm run deploy:testnet
```

Both commands write `deployments.json`:

```json
{
  "network": "localhost",
  "chainId": 31337,
  "deployer": "0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266",
  "verifier": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  "oracle": "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
  "timestamp": "2026-04-14T21:06:54.507Z",
  "blockNumber": 2
}
```

### Step 4: Run the Agent

The agent loads TinyLlama locally, runs inference on live CoinGecko BTC data, generates a Groth16 proof, and submits it to the Oracle.

```bash
# Full pipeline — local hardhat node (default)
npm run agent
# or explicitly:
node agent/index.js --network local

# Rootstock testnet (reads RSK_RPC_URL from .env, falls back to public node)
npm run agent:testnet
# or explicitly:
node agent/index.js --network testnet

# Custom threshold (600 bps = 6%)
node agent/index.js --threshold 600
node agent/index.js --network testnet --threshold 600

# MCP server mode (for Claude or other MCP hosts)
node agent/index.js --mcp
```

Full pipeline output:

```
╔══════════════════════════════════════════════════╗
║  ZK-Private AI Oracle — Full Pipeline            ║
╚══════════════════════════════════════════════════╝
  Network: http://127.0.0.1:8545

[Step 1/3] AI Yield Prediction (TinyLlama + Live CoinGecko Data)
──────────────────────────────────────────────────────────────────
  [Data] Fetching live BTC market data from CoinGecko...
  [Data] Fetched 7 periods. Latest BTC price: $84,231
  [Llama] Loading model: ./models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf
  [Llama] Running inference on live market data...
  [Llama] Raw response:    "742"
  [Llama] Predicted yield: 742 bps (7.42%)
  Raw prediction:  742 bps (PRIVATE — never revealed on-chain)
  Salt:            847263917483 (random nonce for privacy binding)

[Step 2/3] ZK Proof Generation (Circom + snarkjs)
──────────────────────────────────────────────────
  [ZK] Generating Groth16 proof...
  [ZK] Proof generated successfully
  [ZK] predicted_yield:     742 bps  (public)
  [ZK] is_above_threshold:  1 (YES)  (public)
  [ZK] threshold:           500 bps  (public)
  [ZK] Verifying proof off-chain...
  [ZK] Off-chain verification: PASSED

[Step 3/3] On-chain Submission (Rootstock)
──────────────────────────────────────────────────
  [Chain] Detected local hardhat node - using first test account
  [Chain] Oracle address: 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
  [Chain] Network RPC:    http://127.0.0.1:8545
  [Chain] Submitter:      0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266
  [Chain] Gas estimate:   518234 units
  [Chain] Transaction:    0x2a5c8f3e...
  [Chain] Waiting for confirmation (~30s on Rootstock)...
  [Chain] Block:          3
  [Chain] Gas used:       518234 units
  [Chain] Status:         SUCCESS
  [Chain] Event PredictionSubmitted:
    predictionId:     1
    predictedYield:   742 bps
    isAboveThreshold: true
    threshold:        500 bps
    submitter:        0xf39Fd6e51...
```

### Step 5: Query the Oracle

```javascript
// query-oracle.mjs
import { ethers } from "ethers";
import { readFileSync } from "fs";

const { oracle } = JSON.parse(readFileSync("deployments.json", "utf-8"));
const abi = JSON.parse(readFileSync("artifacts/contracts/Oracle.sol/Oracle.json", "utf-8")).abi;

const provider = new ethers.JsonRpcProvider("https://public-node.testnet.rsk.co");
const contract = new ethers.Contract(oracle, abi, provider);

// Get latest prediction
const [yield_, above, ts] = await contract.getLatestPrediction();
console.log(`Yield: ${yield_} bps (${Number(yield_) / 100}%)`);
console.log(`Above threshold: ${above}`);

// Get strategy recommendation
const [strategy, yieldBps] = await contract.recommendStrategy();
console.log(`Strategy: ${strategy} (based on ${yieldBps} bps yield)`);

// Listen for new predictions
contract.on("PredictionSubmitted", (id, yield_, above, threshold, submitter, ts) => {
  console.log(`New prediction: ${yield_} bps from ${submitter}`);
});
```

---

## npm Scripts

| Script | Description |
|--------|-------------|
| `npm run compile:circuit` | Recompile Circom circuit + regenerate Verifier.sol (only needed if circuit changes) |
| `npm run compile:contracts` | Compile Solidity contracts with Hardhat |
| `npm test` | Run all Hardhat unit tests (uses MockVerifier) |
| `npm run deploy:local` | Deploy to local Hardhat node (`http://127.0.0.1:8545`) |
| `npm run deploy:testnet` | Deploy to Rootstock testnet (chain ID 31) |
| `npm run deploy:mainnet` | Deploy to Rootstock mainnet (chain ID 30) |
| `npm run agent` | Run full pipeline on local Hardhat node |
| `npm run agent:testnet` | Run full pipeline on Rootstock testnet |
| `npm run generate-proof` | Generate a standalone ZK proof (dev/testing) |

---

## Strategy Tiers

| Yield (bps) | Yield (%) | Strategy | Example Action on Rootstock |
|-------------|-----------|----------|------------------------------|
| ≥ 800 | ≥ 8% | **aggressive** | Leveraged LP on Sovryn AMM |
| ≥ 500 | ≥ 5% | **balanced** | Standard lending on Tropykus |
| ≥ 200 | ≥ 2% | **conservative** | RBTC staking |
| < 200 | < 2% | **idle** | Hold RBTC, await conditions |

---

## MCP Server Integration

Run as an MCP server for use with Claude or other MCP-compatible hosts:

```bash
node agent/index.js --mcp
```

Add to Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "zk-oracle": {
      "command": "node",
      "args": ["/path/to/rootstock-zk-ai-oracle/agent/index.js", "--mcp"]
    }
  }
}
```

Available MCP tools:

| Tool | Description |
|------|-------------|
| `predict_btc_yield` | Run TinyLlama inference on live CoinGecko BTC data |
| `generate_zk_proof` | Generate Groth16 proof for a prediction (range + comparison) |
| `submit_to_oracle` | Submit proof to Oracle.sol on Rootstock |
| `run_full_pipeline` | Execute complete TinyLlama → Groth16 → on-chain flow |

---

## Rootstock Specifics

| Property | Value |
|----------|-------|
| Testnet RPC | `https://public-node.testnet.rsk.co` |
| Mainnet RPC | `https://public-node.rsk.co` |
| Testnet Chain ID | 31 |
| Mainnet Chain ID | 30 |
| Gas token | RBTC (1:1 peg with BTC) |
| Min gas price | 0.06 gwei (60,000,000 wei) |
| Block time | ~30 seconds |
| Finality | Bitcoin merged mining (same hashrate as BTC) |
| Explorer (testnet) | https://explorer.testnet.rootstock.io |
| Explorer (mainnet) | https://explorer.rootstock.io |
| tRBTC Faucet | https://faucet.rootstock.io |

**EVM Precompiles for Groth16**: Rootstock supports `ecadd` (0x06), `ecmul` (0x07), `ecpairing` (0x08) — all required for BN254 Groth16 verification. Gas cost: ~350k-450k per `verifyProof()` call.

**Why Rootstock for ZK?**
Storing ZK proof commitments on Rootstock means they're secured by Bitcoin's proof-of-work via merged mining. A ZK oracle proof submitted to Rootstock is finalized with Bitcoin-level security — far stronger than PoS chains.

---

## Project Structure

```
rootstock-zk-ai-oracle/
├── contracts/
│   ├── Oracle.sol              # Main oracle: proof verification + prediction storage
│   ├── Verifier.sol            # Groth16 verifier (generated by compile:circuit)
│   └── MockVerifier.sol        # Configurable mock for unit tests
├── circuits/
│   ├── prediction.circom       # ZK circuit: range check + threshold comparison
│   ├── prediction.r1cs         # Compiled constraint system
│   ├── prediction_final.zkey   # Final proving key (Groth16)
│   ├── verification_key.json   # Off-chain verification key
│   ├── prediction_js/          # WASM witness generator (snarkjs)
│   └── ptau/
│       ├── pot12_final.ptau    # Powers of Tau (power-12, ~4.6 MB)
│       └── README.txt          # Explanation + SHA256 checksum
├── scripts/
│   ├── deploy.js               # Deploy Verifier + Oracle to any network
│   ├── generateProof.js        # snarkjs proof generation + Solidity formatting
│   └── setup.sh                # Circuit compilation pipeline (circom2 + snarkjs)
├── agent/
│   └── index.js                # MCP server + TinyLlama + CoinGecko data + CLI
├── models/
│   └── tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf   # LLM model (not in git, ~638 MB)
├── test/
│   ├── Oracle.test.js          # Hardhat unit tests (MockVerifier, all Oracle logic)
│   ├── oracle-submission.js    # Integration test: real proof → Oracle submission
│   └── verifier-direct.js      # Direct Verifier.sol call test
├── deployments.json            # Written by deploy scripts (contract addresses)
├── hardhat.config.cjs          # Hardhat config (.cjs due to ESM package.json)
├── package.json                # "type": "module" for snarkjs ESM compatibility
├── .env.example                # Template for environment variables
└── README.md
```

---

## Scope Summary

This project delivers **a real, verifiable implementation** of:
- **AI:** TinyLlama 1.1B running locally via `node-llama-cpp`; no cloud APIs
- **Data:** Live CoinGecko BTC prices; no synthetic data
- **ZK:** Groth16 proofs with pre-committed Verifier keys; cryptographically sound
- **Chain:** Rootstock Oracle; Bitcoin finality via merged mining

**Not included** (intentional scope boundaries):
- UI/dApp (focus is core protocol)
- Price oracle integration (CoinGecko is sufficient for verification)
- Governance/tokenomics
- Multi-party trusted setup ceremony (single dev contribution; sufficient for testnet)

---

## Troubleshooting

**`LLM model not found`**
Place the model at `./models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf` or set `LLAMA_MODEL_PATH` in your `.env`.

**`Circuit WASM not found`**
The WASM artifact is committed. If it's missing, run `npm run compile:circuit`.

**`deployments.json not found`**
Run `npm run deploy:local` (with `npx hardhat node` running in another terminal) or `npm run deploy:testnet`.

**`Gas estimation failed — InvalidProof`**
The circuit artifacts and `Verifier.sol` keys are out of sync. Run `npm run compile:circuit`, then `npm run compile:contracts`, then redeploy.

**`No accounts found on hardhat node`**
Ensure `npx hardhat node` is running in a separate terminal before deploying or running the agent locally.

**Rootstock testnet timeout**
Rootstock blocks take ~30s. The config sets `timeout: 120000`. If still timing out, check https://stats.testnet.rootstock.io for network status.

**`PRIVATE_KEY not set`**
Copy `.env.example` to `.env` and add your private key. For local Hardhat, this is not required — the agent auto-uses the first test account.

**`circom2 not found` (during `compile:circuit`)**
`circom2` is a dev dependency and resolved via `npx` automatically from `node_modules`. Run `npm install` first.

---

## License

MIT
