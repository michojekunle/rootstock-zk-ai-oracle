# ZK-Private AI Oracle on Rootstock

A yield optimizer dApp where an AI agent privately predicts BTC yield, generates a zero-knowledge proof with Circom, and submits it to a Solidity oracle contract on Rootstock — without revealing the raw prediction on-chain.

```
[Llama AI] ──(private prediction)──▶ [Circom Circuit] ──▶ [ZK Proof]
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
| **Llama AI** | Predicts BTC DeFi yield from market data (kept private) |
| **Circom + Groth16** | Proves the prediction is valid without revealing inputs |
| **Rootstock** | Bitcoin-secured EVM chain — merged mining gives Bitcoin-level finality |
| **RBTC** | Gas token (1:1 peg with BTC) — no ETH needed |
| **MCP** | Orchestrates the full pipeline as composable AI tools |

---

## Architecture

```
agent/index.js
├── Section 1: Mock Llama predictor (replace with node-llama-cpp for production)
│   └── Outputs: raw_prediction (basis points, 0-10000) — PRIVATE
│
├── Section 2: ZK Proof (scripts/generateProof.js)
│   ├── Input:  raw_prediction + salt (private), threshold (public)
│   ├── Circuit: circuits/prediction.circom (Circom 2.0, Groth16)
│   └── Output: proof + public signals [predicted_yield, is_above_threshold, threshold]
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

**Public outputs** (verified and stored on-chain):
- `predicted_yield` — Equals `raw_prediction` (commitment)
- `is_above_threshold` — 1 if `raw_prediction >= threshold`, else 0

**Constraints enforced** (what the proof guarantees):
1. `0 <= raw_prediction <= 10000`
2. `predicted_yield == raw_prediction`
3. `is_above_threshold == (raw_prediction >= threshold)`

---

## Prerequisites

```bash
node --version   # >= 18.0.0 required
npm --version    # >= 9.0.0 recommended
```

Install circom2 (Circom compiler):
```bash
npm install -g circom2
# Or use locally via npx (handled automatically by setup.sh)
```

---

## Setup for Rootstock Testnet

### 1. Clone and install dependencies

```bash
git clone https://github.com/yourname/rootstock-zk-ai-oracle
cd rootstock-zk-ai-oracle
npm install
```

### 2. Get Testnet RBTC

Before deploying contracts, you'll need test Bitcoin (tRBTC) to pay for gas:

```bash
# Go to: https://faucet.rootstock.io
# Request 0.1 - 1.0 tRBTC
# Wait 1-2 minutes for funds to arrive
```

### 3. Configure for Testnet

```bash
cp .env.example .env
```

Edit `.env` and set your testnet account:
```bash
PRIVATE_KEY=0x...YOUR_FUNDED_ACCOUNT_PRIVATE_KEY...
RSK_RPC_URL=https://public-node.testnet.rsk.co
```

⚠️ **Never commit `.env` to git** — it contains your private key!

---

## Step-by-Step Usage

### Step 1: Compile the ZK Circuit

Downloads the Hermez Powers of Tau file (~54 MB, one-time), compiles the Circom circuit, runs trusted setup, and generates `contracts/Verifier.sol`.

```bash
npm run compile:circuit
```

Expected output:
```
[0/5] Checking dependencies...
[1/5] Powers of Tau trusted setup file...
      Downloading (~54 MB) from Hermez ceremony...
[2/5] Compiling prediction.circom...
      Generated: circuits/prediction.r1cs
      Generated: circuits/prediction_js/prediction.wasm
[3/5] Groth16 trusted setup (zkey generation)...
      Generated: circuits/prediction_final.zkey
[4/5] Exporting verification key...
      Generated: circuits/verification_key.json
[5/5] Generating Solidity Verifier contract...
      Generated: contracts/Verifier.sol  ← REAL verifier with hardcoded keys
```

### Step 2: Compile Contracts and Run Tests

```bash
npm run compile:contracts
npm test
```

Expected test output:
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

### Step 3: Deploy Contracts to Rootstock Testnet

First, ensure your `.env` is configured with testnet settings:
```bash
PRIVATE_KEY=0x...  # Your account's private key (from MetaMask/wallet)
RSK_RPC_URL=https://public-node.testnet.rsk.co
```

Then deploy:
```bash
npm run deploy:testnet
```

This will:
1. Deploy `Verifier.sol` (with hardcoded Groth16 verification keys)
2. Deploy `Oracle.sol` (links to Verifier)
3. Write addresses to `deployments.json`

Expected output:
```json
{
  "network": "rskTestnet",
  "chainId": 31,
  "verifier": "0x...",
  "oracle": "0x...",
  "timestamp": "2024-01-15T10:30:00Z"
}
```

**Next Steps:**
- View contract on explorer: `https://explorer.testnet.rootstock.io/address/{oracle_address}`
- Update `dapp-frontend/config.js` with the Oracle address for your frontend
- Continue to Step 4 to submit predictions

### Step 4: Run the Agent

```bash
# Full pipeline: predict → prove → submit to Oracle
node agent/index.js

# With custom threshold (600 bps = 6%)
node agent/index.js --threshold 600

# As MCP server (for use with Claude or other MCP hosts)
node agent/index.js --mcp
```

Full pipeline output:
```
╔══════════════════════════════════════════════════╗
║  ZK-Private AI Oracle — Full Pipeline            ║
╚══════════════════════════════════════════════════╝

[Step 1/3] AI Yield Prediction (Mock Llama)
──────────────────────────────────────────────────
  [Llama] BTC price momentum: 3.59%
  [Llama] Volume factor:       1.40x
  [Llama] Volatility penalty:  12.0 bps
  [Llama] Dominance bonus:     125.0 bps
  [Llama] Predicted yield:     728 bps (7.28%)
  Raw prediction:  728 bps (PRIVATE — never revealed on-chain)
  Salt:            847263917483 (random nonce for privacy binding)

[Step 2/3] ZK Proof Generation (Circom + snarkjs)
──────────────────────────────────────────────────
  [ZK] Public input: threshold=500 bps
  [ZK] Private inputs: hidden (raw_prediction, salt)
  [ZK] Proof generated successfully
  [ZK] predicted_yield:     728 bps
  [ZK] is_above_threshold:  1 (YES)
  [ZK] threshold:           500 bps
  [ZK] Off-chain verification: PASSED

[Step 3/3] On-chain Submission (Rootstock)
──────────────────────────────────────────────────
  [Chain] Oracle address: 0x...
  [Chain] Gas estimate:   423847 units
  [Chain] Transaction:    0x...
  [Chain] Waiting for confirmation (~30s on Rootstock)...
  [Chain] Block:          4521683
  [Chain] Gas used:       419033 units
  [Chain] Status:         SUCCESS
  [Chain] Event PredictionSubmitted:
    predictionId:     5
    predictedYield:   728 bps
    isAboveThreshold: true
    threshold:        500 bps
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

## Rootstock Testnet Deployment

Deploy your oracle to Rootstock testnet for public testing.

### 1. Get Testnet RBTC

Get tRBTC (test Bitcoin) from the faucet:
```bash
# Go to https://faucet.rootstock.io
# Request 0.1 - 1.0 tRBTC (enough for 100+ submissions)
# Wait 1-2 minutes for funds to arrive in your wallet
```

### 2. Update `.env` for Testnet

```bash
# Edit .env:
PRIVATE_KEY=0x...  # Your funded testnet account private key
RSK_RPC_URL=https://public-node.testnet.rsk.co
```

**Important:** Ensure your account has tRBTC before deploying.

### 3. Deploy Contracts

```bash
# Compile circuit (one-time)
npm run compile:circuit

# Compile contracts
npm run compile:contracts

# Deploy to testnet
npm run deploy:testnet
```

Expected output:
```
Step 1/2: Deploying Verifier.sol
Step 2/2: Deploying Oracle.sol

Deployment Complete!

Addresses:
  Verifier: 0x...
  Oracle:   0x...

Saved to: deployments.json

Explorer links:
  Verifier: https://explorer.testnet.rootstock.io/address/0x...
  Oracle:   https://explorer.testnet.rootstock.io/address/0x...
```

### 4. Verify Deployment

```bash
# Verify contracts are accessible on testnet
npm run verify:testnet
```

This will:
- Check both contracts are deployed
- Read the latest prediction from Oracle
- Listen for new PredictionSubmitted events (10 seconds)
- Print explorer links

### 5. Run Agent on Testnet

```bash
# Generate ZK proof and submit to testnet Oracle
node agent/index.js
```

The agent will:
1. Generate a BTC yield prediction (locally)
2. Create a Groth16 ZK proof (locally)
3. Submit the proof to the Oracle contract on testnet
4. Print transaction hash and confirmation

### 6. View on Explorer

Visit the Oracle address on Rootstock testnet explorer:
```
https://explorer.testnet.rootstock.io/address/{ORACLE_ADDRESS}
```

You can:
- View contract code and ABI
- Call `latestPrediction()` and `recommendStrategy()` functions
- See all `PredictionSubmitted` events in the "Logs" tab
- Track transaction history

### Build Frontend dApp (Optional)

Once contracts are deployed on testnet, build a web interface:
```bash
cd dapp-frontend
python3 -m http.server 8000
# Open http://localhost:8000 in your browser
```

See `dapp-frontend/README.md` for setup instructions.

---

## Strategy Tiers

| Yield (bps) | Yield (%) | Strategy | Example Action on Rootstock |
|-------------|-----------|----------|-----------------------------|
| ≥ 800 | ≥ 8% | **aggressive** | Leveraged LP on Sovryn AMM |
| ≥ 500 | ≥ 5% | **balanced** | Standard lending on Tropykus |
| ≥ 200 | ≥ 2% | **conservative** | RBTC staking |
| < 200 | < 2% | **idle** | Hold RBTC, await conditions |

---

## Real Llama Integration

The oracle is pre-configured to support real Llama AI inference. The system automatically uses a real Llama model if available, otherwise falls back to the mock predictor.

### Setup Real Llama (Optional)

#### 1. Install the C++ bindings

```bash
npm install node-llama-cpp
```

#### 2. Download a quantized Llama model

Choose a model size based on your hardware:

```bash
# Small (3B parameters, ~2 GB, 2-3s inference on CPU)
npx node-llama-cpp pull --dir ./models llama3.2:3b

# Medium (8B parameters, ~5 GB, 5-10s inference on CPU)
npx node-llama-cpp pull --dir ./models llama3.2:8b
```

#### 3. Set model path in `.env`

```bash
# Edit .env:
LLAMA_MODEL_PATH=./models/llama-3.2-3b-instruct.Q4_K_M.gguf
```

#### 4. Run with real Llama

```bash
# The agent will automatically load the model on startup
node agent/index.js
```

**Expected output:**
```
[Llama] Loading model from: ./models/llama-3.2-3b-instruct.Q4_K_M.gguf
[Llama] Model loaded successfully
[Step 1/3] AI Yield Prediction (Llama)
[Llama] Generating prediction...
[Llama] Prediction: 750 bps (7.50%)
```

### How It Works

The `llama-predictor.js` module:
- Loads the GGUF model file on startup (if `LLAMA_MODEL_PATH` is set)
- Sends BTC market data to Llama via a structured prompt
- Parses the model's integer response (basis points)
- Falls back to mock predictor if model loading fails

The system **automatically tries Llama first, then falls back to mock** — no code changes needed.

### Performance Notes

- **3B model:** ~2-3 seconds per prediction on CPU
- **8B model:** ~5-10 seconds per prediction on CPU
- **GPU inference:** Use `CUDA_VISIBLE_DEVICES` or hardware-specific bindings (see node-llama-cpp docs)
- Models are cached in memory after first load

### Model Quality

- `3B`: Fast, suitable for testnet / demo
- `8B`: More accurate, production recommended
- `13B+`: Highest quality but slower

See [node-llama-cpp docs](https://github.com/withcatai/node-llama-cpp) for advanced usage.

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
- `predict_btc_yield` — Run AI prediction on BTC market data
- `generate_zk_proof` — Generate Groth16 proof for a prediction
- `submit_to_oracle` — Submit proof to Rootstock Oracle contract
- `run_full_pipeline` — Execute complete predict → prove → submit flow

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
│   ├── Oracle.sol           # Main oracle: proof verification + prediction storage
│   ├── Verifier.sol         # Groth16 verifier (stub → overwritten by compile:circuit)
│   └── MockVerifier.sol     # Configurable mock for unit tests
├── circuits/
│   ├── prediction.circom    # ZK circuit: range check + threshold comparison
│   └── ptau/
│       └── README.txt       # Instructions for Powers of Tau file
├── scripts/
│   ├── deploy.js            # Deploy Verifier + Oracle to any network
│   ├── generateProof.js     # snarkjs proof generation + Solidity formatting
│   └── setup.sh             # Circuit compilation pipeline (circom2 + snarkjs)
├── agent/
│   └── index.js             # MCP server + mock Llama + full pipeline CLI
├── test/
│   └── Oracle.test.js       # Hardhat unit tests (MockVerifier, all Oracle logic)
├── hardhat.config.cjs        # Hardhat config (must be .cjs due to ESM package.json)
├── package.json             # "type": "module" for snarkjs ESM compatibility
├── .env.example             # Template for environment variables
└── README.md
```

---

## Optional: Local Hardhat Development

This system is configured for **Rootstock testnet by default**. However, you can also test locally on a Hardhat node (no testnet RBTC required).

### Local Setup

1. Update `.env`:
```bash
# Comment out testnet settings
# PRIVATE_KEY=0x...
# RSK_RPC_URL=https://public-node.testnet.rsk.co

# Uncomment local hardhat settings (pre-funded test account)
PRIVATE_KEY=0xac0974bec39a17e36ba4a6b4d238ff944bacb476c6b8d6c1f02b86a1649a238f
RSK_RPC_URL=http://127.0.0.1:8545
```

2. Start local Hardhat node:
```bash
npx hardhat node
```

3. In another terminal, deploy locally:
```bash
npm run deploy:local
```

4. Run the agent:
```bash
node agent/index.js
```

The agent will automatically detect the local network and use the pre-funded test account (10,000 test RBTC).

### Local vs. Testnet

| Aspect | Local (Hardhat) | Testnet |
|--------|-----------------|---------|
| Setup | Instant (`npx hardhat node`) | Need tRBTC from faucet |
| Speed | Instant blocks | ~30s blocks |
| Cost | Free (no gas cost) | ~$0.01 per submission |
| Explorer | None (local only) | https://explorer.testnet.rootstock.io |
| Persistence | Cleared on restart | Permanent |
| Use case | Development & testing | Production & public validation |

For production use, **always deploy to Rootstock testnet or mainnet**.

---

## Troubleshooting

**`Circuit WASM not found`**
Run `npm run compile:circuit` first.

**`deployments.json not found`**
Run `npm run deploy:testnet` (primary). Or for local development: `npm run deploy:local` (requires `npx hardhat node` running in another terminal).

**`Gas estimation failed — InvalidProof`**
Using the stub `Verifier.sol` which always returns false. Run `npm run compile:circuit` to generate the real verifier, then `npm run compile:contracts` and redeploy.

**Rootstock testnet timeout**
Rootstock blocks take ~30s. The config has `timeout: 120000`. If still timing out, check https://stats.testnet.rootstock.io for network status.

**`PRIVATE_KEY not set`**
Copy `.env.example` to `.env` and add your private key.

**circom2 not found**
```bash
npm install -g circom2
# Or it will be used via npx automatically
```

---

## License

MIT
