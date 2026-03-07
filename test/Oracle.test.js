// test/Oracle.test.js
// ─────────────────────────────────────────────────────────────────────────────
// Hardhat unit tests for Oracle.sol
//
// Strategy: Use MockVerifier.sol (configurable true/false) so tests run without
// requiring the full Circom circuit compilation pipeline. Oracle business logic
// is tested independently of the ZK proof system.
//
// For integration tests with real ZK proofs (after running npm run compile:circuit),
// see the commented section at the bottom of this file.
//
// Run: npm test
// ─────────────────────────────────────────────────────────────────────────────

import { expect } from "chai";
import hre from "hardhat";
const { ethers } = hre;

describe("Oracle Contract", function () {
  let oracle, trueVerifier, falseVerifier;
  let deployer, user1, user2;

  // ── Mock proof data ─────────────────────────────────────────────────────────
  // These values don't need to be valid Groth16 proofs when using MockVerifier.
  // They just need to match the function signature types.
  const MOCK_PA = [1n, 2n];
  const MOCK_PB = [[1n, 2n], [3n, 4n]];
  const MOCK_PC = [1n, 2n];

  // Public signals: [predicted_yield, is_above_threshold, threshold]
  const SIG_ABOVE = [750n, 1n, 500n];   // yield=750bps, above threshold=500bps
  const SIG_BELOW = [300n, 0n, 500n];   // yield=300bps, below threshold=500bps
  const SIG_EXACT = [500n, 1n, 500n];   // yield=500bps, exactly at threshold

  before(async function () {
    [deployer, user1, user2] = await ethers.getSigners();

    // Deploy MockVerifier that always returns TRUE (valid proof)
    const MockVerifierFactory = await ethers.getContractFactory("MockVerifier");
    trueVerifier = await MockVerifierFactory.deploy(true);
    await trueVerifier.waitForDeployment();

    // Deploy MockVerifier that always returns FALSE (invalid proof)
    falseVerifier = await MockVerifierFactory.deploy(false);
    await falseVerifier.waitForDeployment();

    // Deploy Oracle with the true verifier
    const OracleFactory = await ethers.getContractFactory("Oracle");
    oracle = await OracleFactory.deploy(await trueVerifier.getAddress());
    await oracle.waitForDeployment();
  });

  // ── Deployment ───────────────────────────────────────────────────────────────
  describe("Deployment", function () {
    it("stores the correct verifier address", async function () {
      expect(await oracle.verifier()).to.equal(await trueVerifier.getAddress());
    });

    it("sets deployer as owner", async function () {
      expect(await oracle.owner()).to.equal(deployer.address);
    });

    it("starts with openSubmission = true", async function () {
      expect(await oracle.openSubmission()).to.equal(true);
    });

    it("starts with predictionCount = 0", async function () {
      expect(await oracle.predictionCount()).to.equal(0n);
    });

    it("starts with zero-value latestPrediction", async function () {
      const [yield_, above, ts] = await oracle.getLatestPrediction();
      expect(yield_).to.equal(0n);
      expect(above).to.equal(false);
      expect(ts).to.equal(0n);
    });
  });

  // ── submitPrediction ──────────────────────────────────────────────────────────
  describe("submitPrediction", function () {
    it("accepts a valid proof and increments predictionCount", async function () {
      await oracle.submitPrediction(MOCK_PA, MOCK_PB, MOCK_PC, SIG_ABOVE);
      expect(await oracle.predictionCount()).to.equal(1n);
    });

    it("emits PredictionSubmitted with correct arguments", async function () {
      const tx = await oracle.submitPrediction(MOCK_PA, MOCK_PB, MOCK_PC, SIG_ABOVE);
      const receipt = await tx.wait();

      const event = receipt.logs.find(
        log => oracle.interface.parseLog(log)?.name === "PredictionSubmitted"
      );
      const parsed = oracle.interface.parseLog(event);

      expect(parsed.args.predictedYield).to.equal(750n);
      expect(parsed.args.isAboveThreshold).to.equal(true);
      expect(parsed.args.threshold).to.equal(500n);
      expect(parsed.args.submitter).to.equal(deployer.address);
      expect(parsed.args.timestamp).to.be.gt(0n);
    });

    it("stores prediction in latestPrediction", async function () {
      await oracle.submitPrediction(MOCK_PA, MOCK_PB, MOCK_PC, SIG_BELOW);

      const [yield_, above, ts] = await oracle.getLatestPrediction();
      expect(yield_).to.equal(300n);
      expect(above).to.equal(false);
      expect(ts).to.be.gt(0n);
    });

    it("stores prediction in predictionHistory with correct ID", async function () {
      const beforeCount = await oracle.predictionCount();

      await oracle.submitPrediction(MOCK_PA, MOCK_PB, MOCK_PC, [600n, 1n, 500n]);

      const pred = await oracle.predictionHistory(beforeCount);
      expect(pred.predictedYield).to.equal(600n);
      expect(pred.isAboveThreshold).to.equal(true);
      expect(pred.threshold).to.equal(500n);
      expect(pred.submitter).to.equal(deployer.address);
    });

    it("stores blockNumber in prediction struct", async function () {
      const count = await oracle.predictionCount();
      await oracle.submitPrediction(MOCK_PA, MOCK_PB, MOCK_PC, SIG_ABOVE);

      const pred = await oracle.predictionHistory(count);
      expect(pred.blockNumber).to.be.gt(0n);
    });

    it("handles is_above_threshold=1 correctly (>= not just >)", async function () {
      await oracle.submitPrediction(MOCK_PA, MOCK_PB, MOCK_PC, SIG_EXACT);

      const [yield_, above] = await oracle.getLatestPrediction();
      expect(yield_).to.equal(500n);
      expect(above).to.equal(true);  // 500 >= 500 = true
    });

    it("rejects proof when verifier returns false", async function () {
      const OracleFactory = await ethers.getContractFactory("Oracle");
      const strictOracle = await OracleFactory.deploy(await falseVerifier.getAddress());
      await strictOracle.waitForDeployment();

      await expect(
        strictOracle.submitPrediction(MOCK_PA, MOCK_PB, MOCK_PC, SIG_ABOVE)
      ).to.be.revertedWithCustomError(strictOracle, "InvalidProof");
    });

    it("rejects predicted_yield > 10000 even with valid proof", async function () {
      const badSignals = [10001n, 1n, 500n];

      await expect(
        oracle.submitPrediction(MOCK_PA, MOCK_PB, MOCK_PC, badSignals)
      )
        .to.be.revertedWithCustomError(oracle, "YieldOutOfRange")
        .withArgs(10001n);
    });

    it("accepts boundary value predicted_yield = 10000", async function () {
      const boundarySignals = [10000n, 1n, 500n];
      await expect(
        oracle.submitPrediction(MOCK_PA, MOCK_PB, MOCK_PC, boundarySignals)
      ).to.not.be.reverted;
    });

    it("accepts predicted_yield = 0", async function () {
      const zeroSignals = [0n, 0n, 500n];
      await expect(
        oracle.submitPrediction(MOCK_PA, MOCK_PB, MOCK_PC, zeroSignals)
      ).to.not.be.reverted;
    });
  });

  // ── getPrediction ─────────────────────────────────────────────────────────────
  describe("getPrediction", function () {
    it("returns prediction by ID", async function () {
      // Submit a fresh prediction and get its ID
      const countBefore = await oracle.predictionCount();
      await oracle.submitPrediction(MOCK_PA, MOCK_PB, MOCK_PC, [888n, 1n, 500n]);

      const pred = await oracle.getPrediction(countBefore);
      expect(pred.predictedYield).to.equal(888n);
    });

    it("reverts for out-of-bounds ID", async function () {
      const count = await oracle.predictionCount();
      await expect(
        oracle.getPrediction(count)  // count is one past the last valid ID
      ).to.be.revertedWithCustomError(oracle, "PredictionNotFound")
        .withArgs(count);
    });
  });

  // ── recommendStrategy ─────────────────────────────────────────────────────────
  describe("recommendStrategy", function () {
    async function setYield(yieldBps) {
      await oracle.submitPrediction(MOCK_PA, MOCK_PB, MOCK_PC, [BigInt(yieldBps), 1n, 500n]);
    }

    it('returns "aggressive" for yield >= 800 bps', async function () {
      await setYield(800);
      const [strategy, yield_] = await oracle.recommendStrategy();
      expect(strategy).to.equal("aggressive");
      expect(yield_).to.equal(800n);
    });

    it('returns "aggressive" for yield = 10000 bps (max)', async function () {
      await setYield(10000);
      const [strategy] = await oracle.recommendStrategy();
      expect(strategy).to.equal("aggressive");
    });

    it('returns "balanced" for yield = 500 bps (lower bound)', async function () {
      await setYield(500);
      const [strategy] = await oracle.recommendStrategy();
      expect(strategy).to.equal("balanced");
    });

    it('returns "balanced" for yield = 799 bps (upper bound)', async function () {
      await setYield(799);
      const [strategy] = await oracle.recommendStrategy();
      expect(strategy).to.equal("balanced");
    });

    it('returns "conservative" for yield = 200 bps (lower bound)', async function () {
      await setYield(200);
      const [strategy] = await oracle.recommendStrategy();
      expect(strategy).to.equal("conservative");
    });

    it('returns "conservative" for yield = 499 bps (upper bound)', async function () {
      await setYield(499);
      const [strategy] = await oracle.recommendStrategy();
      expect(strategy).to.equal("conservative");
    });

    it('returns "idle" for yield = 199 bps', async function () {
      await setYield(199);
      const [strategy] = await oracle.recommendStrategy();
      expect(strategy).to.equal("idle");
    });

    it('returns "idle" for yield = 0 bps', async function () {
      await setYield(0);
      const [strategy] = await oracle.recommendStrategy();
      expect(strategy).to.equal("idle");
    });
  });

  // ── Access Control ────────────────────────────────────────────────────────────
  describe("Access Control", function () {
    let restrictedOracle;

    before(async function () {
      // Deploy a fresh oracle for access control tests
      const OracleFactory = await ethers.getContractFactory("Oracle");
      restrictedOracle = await OracleFactory.deploy(await trueVerifier.getAddress());
      await restrictedOracle.waitForDeployment();
    });

    it("allows anyone to submit when openSubmission = true", async function () {
      await expect(
        restrictedOracle.connect(user1).submitPrediction(MOCK_PA, MOCK_PB, MOCK_PC, SIG_ABOVE)
      ).to.not.be.reverted;
    });

    it("blocks non-authorized users when openSubmission = false", async function () {
      await restrictedOracle.setOpenSubmission(false);

      await expect(
        restrictedOracle.connect(user1).submitPrediction(MOCK_PA, MOCK_PB, MOCK_PC, SIG_ABOVE)
      ).to.be.revertedWithCustomError(restrictedOracle, "UnauthorizedSubmitter");
    });

    it("allows authorized submitter when openSubmission = false", async function () {
      // openSubmission is still false from previous test
      await restrictedOracle.setAuthorizedSubmitter(user1.address, true);

      await expect(
        restrictedOracle.connect(user1).submitPrediction(MOCK_PA, MOCK_PB, MOCK_PC, SIG_ABOVE)
      ).to.not.be.reverted;
    });

    it("blocks submitter after authorization is revoked", async function () {
      await restrictedOracle.setAuthorizedSubmitter(user1.address, false);

      await expect(
        restrictedOracle.connect(user1).submitPrediction(MOCK_PA, MOCK_PB, MOCK_PC, SIG_ABOVE)
      ).to.be.revertedWithCustomError(restrictedOracle, "UnauthorizedSubmitter");
    });

    it("only owner can call setOpenSubmission", async function () {
      await expect(
        restrictedOracle.connect(user1).setOpenSubmission(true)
      ).to.be.reverted;
    });

    it("only owner can call setAuthorizedSubmitter", async function () {
      await expect(
        restrictedOracle.connect(user1).setAuthorizedSubmitter(user2.address, true)
      ).to.be.reverted;
    });

    it("only owner can transfer ownership", async function () {
      await expect(
        restrictedOracle.connect(user1).transferOwnership(user2.address)
      ).to.be.reverted;
    });

    it("correctly transfers ownership", async function () {
      const OracleFactory = await ethers.getContractFactory("Oracle");
      const tempOracle = await OracleFactory.deploy(await trueVerifier.getAddress());

      await tempOracle.transferOwnership(user1.address);
      expect(await tempOracle.owner()).to.equal(user1.address);

      // Old owner can no longer perform admin actions
      await expect(
        tempOracle.connect(deployer).setOpenSubmission(false)
      ).to.be.reverted;
    });

    it("reverts transferOwnership to zero address", async function () {
      // Create a fresh oracle and test the zero address guard
      const OracleFactory = await ethers.getContractFactory("Oracle");
      const freshOracle = await OracleFactory.deploy(await trueVerifier.getAddress());
      // Use raw zero address string to avoid ENS resolution (Hardhat doesn't support resolveName)
      await expect(
        freshOracle.transferOwnership("0x0000000000000000000000000000000000000000")
      ).to.be.revertedWith("Oracle: new owner is zero address");
    });
  });

  // ── Events ────────────────────────────────────────────────────────────────────
  describe("Events", function () {
    it("emits SubmitterAuthorized event", async function () {
      await expect(oracle.setAuthorizedSubmitter(user2.address, true))
        .to.emit(oracle, "SubmitterAuthorized")
        .withArgs(user2.address, true);
    });

    it("emits OpenSubmissionToggled event", async function () {
      await expect(oracle.setOpenSubmission(false))
        .to.emit(oracle, "OpenSubmissionToggled")
        .withArgs(false);

      // Restore for other tests
      await oracle.setOpenSubmission(true);
    });
  });

  // ── MockVerifier behavior ─────────────────────────────────────────────────────
  describe("MockVerifier", function () {
    it("can toggle return value mid-test", async function () {
      const MockVerifierFactory = await ethers.getContractFactory("MockVerifier");
      const mock = await MockVerifierFactory.deploy(true);
      const OracleFactory = await ethers.getContractFactory("Oracle");
      const testOracle = await OracleFactory.deploy(await mock.getAddress());

      // Should succeed
      await expect(
        testOracle.submitPrediction(MOCK_PA, MOCK_PB, MOCK_PC, SIG_ABOVE)
      ).to.not.be.reverted;

      // Switch to rejecting proofs
      await mock.setReturnValue(false);

      await expect(
        testOracle.submitPrediction(MOCK_PA, MOCK_PB, MOCK_PC, SIG_ABOVE)
      ).to.be.revertedWithCustomError(testOracle, "InvalidProof");
    });
  });
});

/*
 * ── Integration Tests (requires compiled circuit) ──────────────────────────────
 *
 * Run these after executing `npm run compile:circuit`.
 * Uncomment and run with: INTEGRATION=true npm test
 *
 * // import { generateProof } from "../scripts/generateProof.js";
 *
 * describe("Oracle Integration (real ZK proofs)", function () {
 *   it("verifies a real Groth16 proof", async function () {
 *     if (!process.env.INTEGRATION) this.skip();
 *
 *     const { solidityCalldata } = await generateProof({
 *       rawPrediction: 750,
 *       salt: 12345678,
 *       threshold: 500,
 *     });
 *
 *     // Deploy Oracle with real Verifier
 *     const VerifierFactory = await ethers.getContractFactory("Verifier");
 *     const verifier = await VerifierFactory.deploy();
 *     const OracleFactory = await ethers.getContractFactory("Oracle");
 *     const realOracle = await OracleFactory.deploy(await verifier.getAddress());
 *
 *     const { pA, pB, pC, pubSignals } = solidityCalldata;
 *     await expect(
 *       realOracle.submitPrediction(pA, pB, pC, pubSignals)
 *     ).to.not.be.reverted;
 *
 *     const [yield_] = await realOracle.getLatestPrediction();
 *     expect(yield_).to.equal(750n);
 *   });
 * });
 */
