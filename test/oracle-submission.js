import hre from "hardhat";
import { expect } from "chai";
import { generateProof } from "../scripts/generateProof.js";

describe("Oracle Submission with Real Proof", function () {
  let oracle, verifier;
  let deployer;

  before(async function () {
    [deployer] = await hre.ethers.getSigners();

    // Deploy Verifier
    const Verifier = await hre.ethers.getContractFactory("Groth16Verifier");
    verifier = await Verifier.deploy();
    await verifier.waitForDeployment();

    // Deploy Oracle
    const Oracle = await hre.ethers.getContractFactory("Oracle");
    oracle = await Oracle.deploy(await verifier.getAddress());
    await oracle.waitForDeployment();
  });

  it("should accept a valid proof submission", async function () {
    // Generate proof
    const { solidityCalldata } = await generateProof({
      rawPrediction: 750,
      salt: 123,
      threshold: 500,
    });

    const { pA, pB, pC, pubSignals } = solidityCalldata;

    console.log("\n[TEST] Submitting proof to Oracle.submitPrediction:");
    console.log("  pA:", pA);
    console.log("  pB:", pB);
    console.log("  pC:", pC);
    console.log("  pubSignals:", pubSignals);

    // First, verify directly with the verifier
    const isValid = await verifier.verifyProof(pA, pB, pC, pubSignals);
    console.log("  Verifier.verifyProof returned:", isValid);

    // Now submit to Oracle
    console.log("\n[TEST] Calling oracle.submitPrediction...");
    try {
      const tx = await oracle.submitPrediction(pA, pB, pC, pubSignals);
      const receipt = await tx.wait();
      console.log("  Transaction successful!");
      console.log("  Block:", receipt.blockNumber);
      console.log("  Gas used:", receipt.gasUsed.toString());

      // Check the stored prediction
      const pred = await oracle.latestPrediction();
      console.log("  Stored prediction:");
      console.log("    - predictedYield:", pred.predictedYield.toString());
      console.log("    - isAboveThreshold:", pred.isAboveThreshold);
      console.log("    - threshold:", pred.threshold.toString());

      expect(pred.predictedYield).to.equal(750n);
      expect(pred.isAboveThreshold).to.be.true;
      expect(pred.threshold).to.equal(500n);
    } catch (err) {
      console.error("  ERROR:", err.message);
      throw err;
    }
  });
});
