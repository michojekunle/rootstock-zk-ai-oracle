Powers of Tau — Trusted Setup Files
=====================================

This directory stores the Powers of Tau file from the Hermez Perpetual Powers of Tau ceremony.
These large binary files are NOT committed to git (see .gitignore at the repo root).

WHY IS THIS NEEDED?
-------------------
Groth16 zero-knowledge proofs require a "trusted setup" — a one-time ceremony that
generates cryptographic parameters. The first phase (Powers of Tau) is universal and
can be reused by any Groth16 circuit. The Hermez ceremony involved 1000+ participants;
the security assumption is that at least ONE participant contributed honest randomness.

This is the same ptau used by Polygon zkEVM and many other production ZK systems.

AUTOMATIC DOWNLOAD
------------------
The setup script downloads this file automatically:

  npm run compile:circuit
  # OR manually:
  bash scripts/setup.sh

Source URL:
  https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_12.ptau

File: pot12_final.ptau (~54 MB)
Powers: 12 — supports circuits up to 2^12 = 4096 constraints.

Our PredictionProof circuit uses approximately 50-100 constraints, so power-12 is
more than sufficient.

MANUAL DOWNLOAD
---------------
If the automated download fails, run:

  mkdir -p circuits/ptau
  curl -L "https://storage.googleapis.com/zkevm/ptau/powersOfTau28_hez_final_12.ptau" \
    -o circuits/ptau/pot12_final.ptau

VERIFYING THE FILE
------------------
SHA256 of powersOfTau28_hez_final_12.ptau:
  55c77ce8562366c91e2eb6bf3eb3a4b4e428bb99040d8e6d8b9399b60cb04048

To verify: sha256sum circuits/ptau/pot12_final.ptau

SECURITY NOTE
-------------
For production deployments, consider running an additional phase-2 contribution
ceremony specific to your circuit. The setup.sh script includes a single dev
contribution for prototyping — not suitable for mainnet without additional contributions.
