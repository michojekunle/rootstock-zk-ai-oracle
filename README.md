# ZK-Private AI Oracle on Rootstock

A yield oracle where **TinyLlama** predicts BTC DeFi yield from live market data, generates a **Groth16 ZK proof** proving the prediction is valid, and submits it to a **Solidity oracle** on Rootstock. The proof guarantees authenticity and range without revealing how the AI arrived at the value.

```
TinyLlama (local)
    │  raw_prediction = 742 bps  ← private
    ▼
Circom Groth16 circuit
    │  proof + public signals [742, 1, 500]
    ▼
Oracle.sol on Rootstock
    │  verifyProof() → store → emit PredictionSubmitted
    ▼
DeFi protocols query: getLatestPrediction() / recommendStrategy()
```

---

## What is proven in ZK

**Private inputs** (never leave the prover):
- `raw_prediction` — TinyLlama's numeric output (0–10000 basis points)
- `salt` — random nonce that uniquely binds each proof

**Public inputs / outputs** (committed on-chain and verifiable by anyone):
- `threshold` — comparison value chosen by the operator
- `predicted_yield` — equals `raw_prediction`; the ZK proof guarantees it is authentic
- `is_above_threshold` — 1 if `raw_prediction >= threshold`, else 0

**Constraints enforced by the proof:**
1. `0 ≤ raw_prediction ≤ 10000` — valid basis-points range
2. `predicted_yield == raw_prediction` — output is authentic
3. `is_above_threshold == (raw_prediction >= threshold)` — comparison is correct
4. Salt is bound to the witness — prevents replay

---

## Prerequisites

```bash
node --version   # >= 18.0.0 (built-in fetch required)
```

All other dependencies (`circom2`, `snarkjs`, `node-llama-cpp`, `ethers`, `hardhat`) install via `npm install`. No global tools required.

---

## Setup (fresh clone)

### 1. Install dependencies

```bash
git clone https://github.com/yourname/rootstock-zk-ai-oracle
cd rootstock-zk-ai-oracle
npm install
```

### 2. Download the TinyLlama model

The agent runs **TinyLlama 1.1B (Q4_K_M)** locally via `node-llama-cpp`. Place the GGUF file at:

```
models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf
```

```bash
mkdir -p models
curl -L "https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf" \
  -o models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf
```

To use a different GGUF model, set `LLAMA_MODEL_PATH` in `.env`.

### 3. Compile the ZK circuit

The circuit artifacts (`.r1cs`, `.wasm`, `.zkey`, `verification_key.json`, `Verifier.sol`) are **not committed to git** — they are generated locally. Run:

```bash
npm run compile:circuit
```

This script (`scripts/setup.sh`) does the following:

| Step | Action | Output |
|------|--------|--------|
| 1 | Check `circom2` + `snarkjs` in `node_modules` | — |
| 2 | Download Powers of Tau (~4.6 MB, one-time) | `circuits/ptau/pot12_final.ptau` |
| 3 | Compile `prediction.circom` | `prediction.r1cs`, `prediction_js/prediction.wasm` |
| 4 | Groth16 trusted setup | `prediction_final.zkey` |
| 5 | Export verification key | `circuits/verification_key.json` |
| 6 | Generate Solidity verifier | `contracts/Verifier.sol` |

> **After any circuit change**, re-run `compile:circuit`, then `compile:contracts`, then redeploy — `Verifier.sol` gets new hardcoded keys every time.

### 4. Compile contracts

```bash
npm run compile:contracts
```

### 5. Run tests

```bash
npm test
```

Expected: **39 passing**. Includes unit tests (MockVerifier) and two integration tests — a direct `Groth16Verifier.verifyProof()` call and a full `Oracle.submitPrediction()` with a real Groth16 proof.

### 6. Configure environment (testnet only)

For local Hardhat, no `.env` is needed — the agent uses the first test account automatically.

For testnet:

```bash
cp .env.example .env
```

Edit `.env`:

```bash
PRIVATE_KEY=0xYOUR_PRIVATE_KEY    # wallet with tRBTC
RSK_RPC_URL=https://public-node.testnet.rsk.co
```

Get tRBTC: https://faucet.rootstock.io

### 7. Deploy contracts

**Local:**
```bash
# Terminal 1
npx hardhat node

# Terminal 2
npm run deploy:local
```

**Testnet:**
```bash
npm run deploy:testnet
```

Both write `deployments.json`:

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

### 8. Run the agent

```bash
# Local hardhat node (default)
npm run agent

# Rootstock testnet
npm run agent:testnet

# With a custom threshold
node agent/index.js --threshold 600
node agent/index.js --network testnet --threshold 600
```

Expected output:

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
  Raw prediction:  742 bps
  Salt:            847263917483

[Step 2/3] ZK Proof Generation (Circom + snarkjs)
────────────────────────────────────────────────────
  [ZK] Generating Groth16 proof...
  [ZK] Proof generated successfully
  [ZK] predicted_yield:     742 bps  (public)
  [ZK] is_above_threshold:  1 (YES)  (public)
  [ZK] threshold:           500 bps  (public)
  [ZK] Verifying proof off-chain...
  [ZK] Off-chain verification: PASSED

[Step 3/3] On-chain Submission (Rootstock)
────────────────────────────────────────────
  [Chain] Detected local hardhat node - using first test account
  [Chain] Oracle address: 0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512
  [Chain] Network RPC:    http://127.0.0.1:8545
  [Chain] Gas estimate:   518234 units
  [Chain] Transaction:    0x2a5c8f3e...
  [Chain] Block:          3
  [Chain] Gas used:       518234 units
  [Chain] Status:         SUCCESS
  [Chain] Event PredictionSubmitted:
    predictionId:     1
    predictedYield:   742 bps
    isAboveThreshold: true
    threshold:        500 bps
```

---

## npm Scripts

| Script | Description |
|--------|-------------|
| `npm run compile:circuit` | Compile Circom circuit + regenerate all ZK artifacts + `Verifier.sol` |
| `npm run compile:contracts` | Compile Solidity with Hardhat |
| `npm test` | Run all 39 tests (unit + integration) |
| `npm run deploy:local` | Deploy to local Hardhat node |
| `npm run deploy:testnet` | Deploy to Rootstock testnet (chain ID 31) |
| `npm run deploy:mainnet` | Deploy to Rootstock mainnet (chain ID 30) |
| `npm run agent` | Run full pipeline on local Hardhat node (default) |
| `npm run agent:testnet` | Run full pipeline on Rootstock testnet |
| `npm run generate-proof` | Generate a standalone proof (dev/debug) |

---

## Project Structure

```
rootstock-zk-ai-oracle/
├── contracts/
│   ├── Oracle.sol              # Main oracle: proof verification + prediction storage
│   ├── Verifier.sol            # Groth16 verifier — generated by compile:circuit
│   └── MockVerifier.sol        # Configurable mock for unit tests
├── circuits/
│   ├── prediction.circom       # ZK circuit source (only file committed in circuits/)
│   ├── prediction.r1cs         # ← generated by compile:circuit
│   ├── prediction_final.zkey   # ← generated by compile:circuit
│   ├── verification_key.json   # ← generated by compile:circuit
│   ├── prediction_js/          # ← generated by compile:circuit (WASM witness gen)
│   └── ptau/
│       ├── pot12_final.ptau    # ← downloaded by compile:circuit (~4.6 MB, one-time)
│       └── README.txt
├── scripts/
│   ├── deploy.js               # Deploy Verifier + Oracle to any network
│   ├── generateProof.js        # snarkjs proof generation + Solidity calldata formatting
│   └── setup.sh                # Circuit compilation pipeline
├── agent/
│   └── index.js                # TinyLlama + CoinGecko + ZK pipeline + MCP server
├── models/
│   └── tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf   # ← download manually (~638 MB)
├── test/
│   ├── Oracle.test.js          # Unit tests: all Oracle logic via MockVerifier
│   ├── oracle-submission.js    # Integration: real Groth16 proof → Oracle.submitPrediction
│   └── verifier-direct.js      # Integration: direct Groth16Verifier.verifyProof call
├── hardhat.config.cjs          # Hardhat config (.cjs required by ESM package.json)
├── package.json
├── .env.example
└── README.md
```

---

## Strategy Tiers

| Yield (bps) | Yield (%) | Strategy | Example on Rootstock |
|-------------|-----------|----------|----------------------|
| ≥ 800 | ≥ 8% | **aggressive** | Leveraged LP on Sovryn AMM |
| ≥ 500 | ≥ 5% | **balanced** | Standard lending on Tropykus |
| ≥ 200 | ≥ 2% | **conservative** | RBTC staking |
| < 200 | < 2% | **idle** | Hold RBTC, await conditions |

---

## MCP Server

Run as an MCP server for use with Claude or other MCP-compatible hosts:

```bash
node agent/index.js --mcp
```

Add to Claude Desktop (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "zk-oracle": {
      "command": "node",
      "args": ["/absolute/path/to/rootstock-zk-ai-oracle/agent/index.js", "--mcp"]
    }
  }
}
```

| Tool | Description |
|------|-------------|
| `predict_btc_yield` | Fetch live CoinGecko data + run TinyLlama inference |
| `generate_zk_proof` | Generate Groth16 proof for a given prediction |
| `submit_to_oracle` | Submit proof to Oracle.sol (`network`: `local` or `testnet`) |
| `run_full_pipeline` | predict → prove → submit in one call |

---

## Rootstock

| Property | Value |
|----------|-------|
| Testnet RPC | `https://public-node.testnet.rsk.co` |
| Mainnet RPC | `https://public-node.rsk.co` |
| Testnet chain ID | 31 |
| Mainnet chain ID | 30 |
| Gas token | RBTC (1:1 peg with BTC) |
| Min gas price | 0.06 gwei |
| Block time | ~30 seconds |
| Finality | Bitcoin merged mining |
| Testnet explorer | https://explorer.testnet.rootstock.io |
| tRBTC faucet | https://faucet.rootstock.io |

Rootstock supports `ecadd` (0x06), `ecmul` (0x07), `ecpairing` (0x08) — all BN254 precompiles required for Groth16. Gas cost: ~520k per `submitPrediction()` call (includes proof verification + storage).

---

## Scope

**Included:**
- TinyLlama 1.1B running locally via `node-llama-cpp` — no cloud API
- Live BTC market data from CoinGecko — no synthetic data
- Groth16 ZK proofs via Circom + snarkjs — cryptographically sound
- Rootstock oracle contract — Bitcoin-finality secured

**Not included** (intentional boundaries):
- Frontend / dApp UI
- On-chain price oracle (CoinGecko fetch is off-chain)
- Governance / tokenomics
- Multi-party trusted setup (single-contributor zkey; sufficient for testnet)

---

## Troubleshooting

**`LLM model not found`**
Download the model: `curl -L <HuggingFace URL> -o models/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf`. Or set `LLAMA_MODEL_PATH` in `.env`.

**`fetch failed` / CoinGecko error**
CoinGecko's free tier can throttle without an API key. The agent retries once automatically. If it persists, wait 60 seconds and retry — or check https://status.coingecko.com.

**`Circuit WASM not found` / `ZKey not found`**
Run `npm run compile:circuit` — the circuit artifacts are not committed to git and must be generated locally.

**`Gas estimation failed — InvalidProof`**
`Verifier.sol` and `prediction_final.zkey` are out of sync. Re-run `npm run compile:circuit`, then `npm run compile:contracts`, then redeploy.

**`deployments.json not found`**
Deploy first: `npm run deploy:local` (with `npx hardhat node` running) or `npm run deploy:testnet`.

**`No accounts found on hardhat node`**
Ensure `npx hardhat node` is running in a separate terminal before deploying or running the agent locally.

**`PRIVATE_KEY not set`**
Required for testnet/mainnet only. For local Hardhat, the agent uses the first test account automatically.

---

## License

MIT
