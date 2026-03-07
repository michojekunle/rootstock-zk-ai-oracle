/**
 * verify-testnet.js
 *
 * Verifies that Oracle contracts are deployed and accessible on Rootstock testnet.
 * Run after npm run deploy:testnet to confirm deployment success.
 *
 * Usage:
 *   node scripts/verify-testnet.js
 */

import { ethers } from "ethers";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");

async function verifyTestnet() {
  console.log("\n╔════════════════════════════════════════════╗");
  console.log("║  Rootstock Testnet Deployment Verification ║");
  console.log("╚════════════════════════════════════════════╝\n");

  // 1. Check deployments.json exists
  const deployPath = path.join(ROOT, "deployments.json");
  if (!existsSync(deployPath)) {
    console.error("❌ deployments.json not found. Run: npm run deploy:testnet");
    process.exit(1);
  }

  const deployment = JSON.parse(readFileSync(deployPath, "utf-8"));
  console.log("✓ Found deployments.json");
  console.log(`  Network: ${deployment.network}`);
  console.log(`  Chain ID: ${deployment.chainId}`);
  console.log(`  Verifier: ${deployment.verifier}`);
  console.log(`  Oracle:   ${deployment.oracle}`);

  // 2. Check if deployed to testnet (chainId 31)
  if (deployment.chainId !== 31) {
    console.warn(`⚠ Warning: Deployed to chainId ${deployment.chainId}, expected testnet (31)`);
  }

  // 3. Connect to Rootstock testnet RPC
  const rpcUrl = "https://public-node.testnet.rsk.co";
  const provider = new ethers.JsonRpcProvider(rpcUrl);

  console.log("\n✓ Connected to Rootstock testnet RPC");

  // 4. Verify Verifier contract exists and has code
  const verifierCode = await provider.getCode(deployment.verifier);
  if (verifierCode === "0x") {
    console.error("❌ Verifier contract not deployed at", deployment.verifier);
    process.exit(1);
  }
  console.log(`✓ Verifier.sol deployed at ${deployment.verifier}`);
  console.log(`  Code size: ${(verifierCode.length / 2).toLocaleString()} bytes`);

  // 5. Verify Oracle contract exists and has code
  const oracleCode = await provider.getCode(deployment.oracle);
  if (oracleCode === "0x") {
    console.error("❌ Oracle contract not deployed at", deployment.oracle);
    process.exit(1);
  }
  console.log(`✓ Oracle.sol deployed at ${deployment.oracle}`);
  console.log(`  Code size: ${(oracleCode.length / 2).toLocaleString()} bytes`);

  // 6. Try to read latest prediction
  try {
    const oracleArtifact = JSON.parse(
      readFileSync(path.join(ROOT, "artifacts/contracts/Oracle.sol/Oracle.json"), "utf-8")
    );
    const oracle = new ethers.Contract(deployment.oracle, oracleArtifact.abi, provider);

    const pred = await oracle.latestPrediction();
    const yieldBps = Number(pred.predictedYield);
    const timestamp = new Date(Number(pred.timestamp) * 1000).toISOString();

    console.log("\n✓ Oracle.latestPrediction() is accessible");
    console.log(`  Yield: ${yieldBps} bps (${(yieldBps / 100).toFixed(2)}%)`);
    console.log(`  Above threshold: ${pred.isAboveThreshold}`);
    console.log(`  Timestamp: ${timestamp}`);

    // 7. Listen for new predictions
    console.log("\n✓ Listening for new PredictionSubmitted events (10 seconds)...");
    let eventCount = 0;

    oracle.on("PredictionSubmitted", (id, yield_, above, threshold, submitter, ts) => {
      eventCount++;
      console.log(`  [Event] Prediction #${id}: ${yield_} bps, above=${above}, submitter=${submitter.slice(0, 6)}...`);
    });

    // Wait for 10 seconds
    await new Promise((resolve) => setTimeout(resolve, 10000));

    if (eventCount === 0) {
      console.log("  (No new events in last 10 seconds)");
    }

    oracle.removeAllListeners("PredictionSubmitted");
  } catch (err) {
    console.error("❌ Error reading Oracle contract:", err.message);
    process.exit(1);
  }

  // 8. Summary
  console.log("\n╔════════════════════════════════════════════╗");
  console.log("║  Verification Complete! ✓                  ║");
  console.log("╚════════════════════════════════════════════╝");

  console.log("\nNext steps:");
  console.log(`  1. View on explorer: https://explorer.testnet.rootstock.io/address/${deployment.oracle}`);
  console.log(`  2. Update .env with ORACLE_ADDRESS=${deployment.oracle}`);
  console.log(`  3. Run agent: node agent/index.js`);
  console.log(`  4. Or build frontend: cd dapp-frontend && python3 -m http.server 8000`);

  process.exit(0);
}

verifyTestnet().catch((err) => {
  console.error("\n❌ Verification failed:", err.message);
  process.exit(1);
});
