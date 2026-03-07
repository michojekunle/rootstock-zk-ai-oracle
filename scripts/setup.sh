#!/usr/bin/env bash
# scripts/setup.sh
# ─────────────────────────────────────────────────────────────────────────────
# Full Circom circuit compilation pipeline for the PredictionProof circuit.
#
# What this script does:
#   1. Checks that circom2 and snarkjs are available
#   2. Downloads the Hermez Powers of Tau file (if not already present)
#   3. Compiles prediction.circom to .r1cs + .wasm + .sym
#   4. Runs Groth16 trusted setup (groth16 setup + zkey contribute)
#   5. Exports the verification key (JSON) and Solidity verifier contract
#
# After this script completes:
#   circuits/prediction_js/prediction.wasm  ← used by snarkjs to generate proofs
#   circuits/prediction_final.zkey          ← proving key
#   circuits/verification_key.json          ← for off-chain verification
#   contracts/Verifier.sol                  ← OVERWRITTEN with real Groth16 verifier
#
# Run with: npm run compile:circuit  (or: bash scripts/setup.sh)
# ─────────────────────────────────────────────────────────────────────────────
set -e  # Exit immediately on error

# ── Paths ─────────────────────────────────────────────────────────────────────
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CIRCUITS_DIR="$ROOT/circuits"
PTAU_DIR="$CIRCUITS_DIR/ptau"
PTAU_FILE="$PTAU_DIR/pot12_final.ptau"
CIRCOM_FILE="$CIRCUITS_DIR/prediction.circom"
CONTRACTS_DIR="$ROOT/contracts"

# ── Colors (using printf — portable across all POSIX shells) ──────────────────
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
CYAN='\033[0;36m'
NC='\033[0m'  # No Color

printf "\n"
printf "${CYAN}╔══════════════════════════════════════════════╗${NC}\n"
printf "${CYAN}║  ZK Oracle — Circuit Compilation Pipeline    ║${NC}\n"
printf "${CYAN}╚══════════════════════════════════════════════╝${NC}\n"
printf "\n"

# ── Guard: npm install must be run first ──────────────────────────────────────
# npx resolves binaries from node_modules/.bin — if node_modules is absent,
# every npx call fails with a confusing "not found" error.
if [ ! -d "$ROOT/node_modules" ]; then
  printf "${RED}ERROR: node_modules not found.${NC}\n"
  printf "Run this first:\n"
  printf "  npm install\n"
  printf "\n"
  exit 1
fi

# ── Step 0: Check dependencies ────────────────────────────────────────────────
printf "${YELLOW}[0/5] Checking dependencies...${NC}\n"

# Try global circom2 first, fall back to local npx
if command -v circom2 &>/dev/null; then
  CIRCOM_CMD="circom2"
elif npx circom2 --version &>/dev/null 2>&1; then
  CIRCOM_CMD="npx circom2"
else
  printf "${RED}ERROR: circom2 not found.${NC}\n"
  printf "Install globally: npm install -g circom2\n"
  printf "Or locally:       npm install --save-dev circom2\n"
  exit 1
fi

# snarkjs is a local dependency (listed in package.json devDependencies).
# We use node_modules/.bin directly for a faster, more reliable check.
if [ -f "$ROOT/node_modules/.bin/snarkjs" ]; then
  SNARKJS_CMD="npx snarkjs"
elif npx snarkjs --version &>/dev/null 2>&1; then
  SNARKJS_CMD="npx snarkjs"
else
  printf "${RED}ERROR: snarkjs not found.${NC}\n"
  printf "Run: npm install\n"
  exit 1
fi

# circomlib is required by prediction.circom (comparators, bitify)
if [ ! -f "$ROOT/node_modules/circomlib/circuits/comparators.circom" ]; then
  printf "${RED}ERROR: circomlib not found in node_modules.${NC}\n"
  printf "Run: npm install\n"
  exit 1
fi

printf "  circom2:   OK (using: %s)\n" "$CIRCOM_CMD"
printf "  snarkjs:   OK (using: %s)\n" "$SNARKJS_CMD"
printf "  circomlib: OK\n"

# ── Step 1: Download Powers of Tau ────────────────────────────────────────────
printf "\n"
printf "${YELLOW}[1/5] Powers of Tau trusted setup file...${NC}\n"
mkdir -p "$PTAU_DIR"

if [ -f "$PTAU_FILE" ]; then
  printf "  Already present: %s\n" "$PTAU_FILE"
else
  PTAU_URL="https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_12.ptau"
  printf "  Downloading (~54 MB) from Hermez ceremony...\n"
  printf "  URL: %s\n" "$PTAU_URL"
  printf "  This is a one-time download — reused for all future setups.\n"
  printf "\n"

  if command -v curl &>/dev/null; then
    curl -L "$PTAU_URL" -o "$PTAU_FILE" --progress-bar
  elif command -v wget &>/dev/null; then
    wget -q --show-progress "$PTAU_URL" -O "$PTAU_FILE"
  else
    printf "${RED}ERROR: Neither curl nor wget found. Download manually:${NC}\n"
    printf "  curl -L '%s' -o '%s'\n" "$PTAU_URL" "$PTAU_FILE"
    exit 1
  fi

  printf "  Downloaded: %s\n" "$PTAU_FILE"
fi

# ── Step 2: Compile Circom circuit ────────────────────────────────────────────
printf "\n"
printf "${YELLOW}[2/5] Compiling prediction.circom...${NC}\n"

# Clean up old outputs to avoid stale files
rm -f "$CIRCUITS_DIR/prediction.r1cs"
rm -f "$CIRCUITS_DIR/prediction.sym"
rm -rf "$CIRCUITS_DIR/prediction_js"

$CIRCOM_CMD "$CIRCOM_FILE" \
  --r1cs \
  --wasm \
  --sym \
  --output "$CIRCUITS_DIR" \
  -l "$ROOT/node_modules"

printf "  Generated: circuits/prediction.r1cs\n"
printf "  Generated: circuits/prediction_js/prediction.wasm\n"
printf "  Generated: circuits/prediction.sym\n"
printf "\n"
printf "  Circuit statistics:\n"
$SNARKJS_CMD r1cs info "$CIRCUITS_DIR/prediction.r1cs" 2>&1 | grep -E "Constraints|Wires|Labels" | sed 's/^/    /'

# ── Step 3: Groth16 trusted setup ─────────────────────────────────────────────
printf "\n"
printf "${YELLOW}[3/5] Groth16 trusted setup (zkey generation)...${NC}\n"

# Clean up old zkeys
rm -f "$CIRCUITS_DIR/prediction_0000.zkey"
rm -f "$CIRCUITS_DIR/prediction_final.zkey"

# Phase 2 setup: circuit-specific zkey derived from ptau
printf "  Running groth16 setup...\n"
$SNARKJS_CMD groth16 setup \
  "$CIRCUITS_DIR/prediction.r1cs" \
  "$PTAU_FILE" \
  "$CIRCUITS_DIR/prediction_0000.zkey"

printf "  Generated: circuits/prediction_0000.zkey (initial phase-2 key)\n"

# Contribute randomness to finalize the zkey.
# In production, multiple independent parties contribute.
# For development, a single contribution is sufficient.
printf "  Contributing randomness...\n"
ENTROPY="dev-entropy-$(date +%s)-$(od -An -N4 -tu4 /dev/urandom | tr -d ' ')"
echo "$ENTROPY" | $SNARKJS_CMD zkey contribute \
  "$CIRCUITS_DIR/prediction_0000.zkey" \
  "$CIRCUITS_DIR/prediction_final.zkey" \
  --name="ZK Oracle Dev Contribution" \
  -v 2>&1 | tail -5

printf "  Generated: circuits/prediction_final.zkey (final proving key)\n"

# ── Step 4: Export verification key ───────────────────────────────────────────
printf "\n"
printf "${YELLOW}[4/5] Exporting verification key...${NC}\n"

$SNARKJS_CMD zkey export verificationkey \
  "$CIRCUITS_DIR/prediction_final.zkey" \
  "$CIRCUITS_DIR/verification_key.json"

printf "  Generated: circuits/verification_key.json\n"

# ── Step 5: Generate Solidity verifier ────────────────────────────────────────
printf "\n"
printf "${YELLOW}[5/5] Generating Solidity Verifier contract...${NC}\n"

$SNARKJS_CMD zkey export solidityverifier \
  "$CIRCUITS_DIR/prediction_final.zkey" \
  "$CONTRACTS_DIR/Verifier.sol"

printf "  Generated: contracts/Verifier.sol (REAL Groth16 verifier with hardcoded keys)\n"

# ── Summary ───────────────────────────────────────────────────────────────────
printf "\n"
printf "${GREEN}╔════════════════════════════════════════╗${NC}\n"
printf "${GREEN}║   Circuit compilation COMPLETE!        ║${NC}\n"
printf "${GREEN}╚════════════════════════════════════════╝${NC}\n"
printf "\n"
printf "  Generated artifacts:\n"
printf "    circuits/prediction.r1cs\n"
printf "    circuits/prediction_js/prediction.wasm\n"
printf "    circuits/prediction_final.zkey\n"
printf "    circuits/verification_key.json\n"
printf "    contracts/Verifier.sol  (overwritten with real verifier)\n"
printf "\n"
printf "  Next steps:\n"
printf "    npm run compile:contracts   # Compile Oracle.sol + new Verifier.sol\n"
printf "    npm test                    # Run unit tests\n"
printf "    npm run deploy:local        # Deploy to local hardhat node\n"
printf "    npm run deploy:testnet      # Deploy to Rootstock testnet\n"
printf "\n"
