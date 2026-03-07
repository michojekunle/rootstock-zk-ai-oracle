// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/*
 * ╔══════════════════════════════════════════════════════════════════════════╗
 * ║  ZK-Private AI Yield Oracle for Rootstock                               ║
 * ║                                                                          ║
 * ║  This contract accepts Groth16 zero-knowledge proofs that attest to an  ║
 * ║  AI agent's BTC yield prediction without revealing the raw model output. ║
 * ║                                                                          ║
 * ║  Deployed on Rootstock (chainId 31 = testnet, 30 = mainnet).            ║
 * ║  Gas is paid in RBTC (Smart Bitcoin — 1:1 peg with BTC).                ║
 * ║  Rootstock uses merged mining: Bitcoin miners secure this contract.      ║
 * ║                                                                          ║
 * ║  System flow:                                                            ║
 * ║    AI Agent (private)  ──▶  Circom proof  ──▶  submitPrediction()       ║
 * ║    DeFi protocol       ◀──  getLatestPrediction() / recommendStrategy() ║
 * ╚══════════════════════════════════════════════════════════════════════════╝
 *
 * ZK Proof Structure (Groth16 on BN254 curve):
 *   Private inputs (hidden): raw_prediction (AI output), salt (privacy nonce)
 *   Public inputs:           threshold (configurable by operator)
 *   Public outputs:          predicted_yield (= raw_prediction), is_above_threshold
 *
 * Public signals layout passed to verifyProof():
 *   _pubSignals[0] = predicted_yield       (0-10000 basis points)
 *   _pubSignals[1] = is_above_threshold    (0 or 1)
 *   _pubSignals[2] = threshold             (basis points threshold used)
 *
 * The ZK proof guarantees (without revealing raw_prediction):
 *   1. predicted_yield == raw_prediction (commitment: on-chain value is authentic)
 *   2. is_above_threshold == (raw_prediction >= threshold) (correct comparison)
 *   3. 0 <= raw_prediction <= 10000 (valid basis points range)
 */

// ── Verifier Interface ────────────────────────────────────────────────────────
// This interface matches both contracts/Verifier.sol (real) and MockVerifier.sol (test).
interface IVerifier {
    function verifyProof(
        uint[2] calldata _pA,
        uint[2][2] calldata _pB,
        uint[2] calldata _pC,
        uint[3] calldata _pubSignals
    ) external view returns (bool);
}

// ── Oracle Contract ───────────────────────────────────────────────────────────
contract Oracle {

    // ── Custom Errors ─────────────────────────────────────────────────────────
    // Custom errors use less gas than require() with strings (Solidity >=0.8.4)
    error InvalidProof();
    error UnauthorizedSubmitter();
    error YieldOutOfRange(uint256 yield);
    error PredictionNotFound(uint256 predictionId);

    // ── Structs ───────────────────────────────────────────────────────────────
    struct Prediction {
        uint256 predictedYield;    // Yield in basis points (0-10000). 100 bps = 1%.
        bool    isAboveThreshold;  // true if predicted_yield >= threshold
        uint256 threshold;         // The threshold used in this prediction's ZK proof
        address submitter;         // Address that submitted the proof (pays RBTC gas)
        uint256 timestamp;         // block.timestamp at submission
        uint256 blockNumber;       // block.number for Bitcoin finality reference
    }

    // ── State Variables ───────────────────────────────────────────────────────
    IVerifier public immutable verifier;   // Groth16 verifier (set at deploy time)
    address   public           owner;

    Prediction public latestPrediction;    // Most recent verified prediction
    uint256    public predictionCount;     // Total number of predictions submitted

    // Full history of predictions — useful for DeFi protocols building on this oracle
    mapping(uint256 => Prediction) public predictionHistory;

    // Access control: restrict who can submit proofs (useful on mainnet)
    mapping(address => bool) public authorizedSubmitters;
    bool public openSubmission;  // If true, anyone can submit. Default: true (testnet).

    // ── Events ────────────────────────────────────────────────────────────────
    /**
     * @dev Emitted when a ZK proof is verified and a prediction is stored.
     * DeFi protocols listen to this event to trigger portfolio rebalancing.
     *
     * @param predictionId   Sequential ID (0-indexed)
     * @param predictedYield BTC yield prediction in basis points
     * @param isAboveThreshold Whether prediction exceeded the threshold
     * @param threshold      The threshold used for comparison
     * @param submitter      Address of the oracle agent that submitted the proof
     * @param timestamp      Block timestamp of submission
     */
    event PredictionSubmitted(
        uint256 indexed predictionId,
        uint256         predictedYield,
        bool            isAboveThreshold,
        uint256         threshold,
        address indexed submitter,
        uint256         timestamp
    );

    event SubmitterAuthorized(address indexed submitter, bool authorized);
    event OpenSubmissionToggled(bool isOpen);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ── Modifiers ─────────────────────────────────────────────────────────────
    modifier onlyOwner() {
        require(msg.sender == owner, "Oracle: not owner");
        _;
    }

    modifier onlyAuthorized() {
        if (!openSubmission && !authorizedSubmitters[msg.sender]) {
            revert UnauthorizedSubmitter();
        }
        _;
    }

    // ── Constructor ───────────────────────────────────────────────────────────
    /**
     * @param _verifier Address of the deployed Groth16 Verifier contract.
     *                  Must implement IVerifier interface.
     *                  On testnet, deploy Verifier.sol first, then pass its address here.
     */
    constructor(address _verifier) {
        verifier = IVerifier(_verifier);
        owner = msg.sender;
        openSubmission = true;  // Open by default for testnet prototyping
    }

    // ── Core Functions ────────────────────────────────────────────────────────

    /**
     * @notice Submit a Groth16 ZK proof of an AI yield prediction.
     *
     * The proof cryptographically attests (without revealing raw_prediction or salt):
     *   - predicted_yield == raw_prediction (the public output IS the AI model's output)
     *   - is_above_threshold == (raw_prediction >= threshold) (correct comparison)
     *   - 0 <= raw_prediction <= 10000 (valid basis points range)
     *
     * Uses Rootstock's EVM precompiles for pairing check:
     *   ecadd (0x06), ecmul (0x07), ecpairing (0x08) on BN254 curve.
     * Gas cost: approximately 350,000-450,000 gas for the pairing check.
     *
     * @param _pA  Proof element A: G1 point [x, y]
     * @param _pB  Proof element B: G2 point [[x1,x2],[y1,y2]]
     * @param _pC  Proof element C: G1 point [x, y]
     * @param _pubSignals Public signals [predicted_yield, is_above_threshold, threshold]
     *
     * @return predictionId The sequential ID of the stored prediction
     */
    function submitPrediction(
        uint[2]    calldata _pA,
        uint[2][2] calldata _pB,
        uint[2]    calldata _pC,
        uint[3]    calldata _pubSignals
    ) external onlyAuthorized returns (uint256 predictionId) {

        // ── Step 1: Verify ZK proof on-chain ──────────────────────────────────
        // Calls the Groth16 verifier which uses ecpairing precompile.
        // If proof is invalid, this returns false and we revert.
        bool valid = verifier.verifyProof(_pA, _pB, _pC, _pubSignals);
        if (!valid) revert InvalidProof();

        // ── Step 2: Parse public signals ──────────────────────────────────────
        // Signal ordering is determined by snarkjs (outputs first, then public inputs).
        // Must match circuits/prediction.circom's signal declaration order.
        uint256 predictedYield   = _pubSignals[0];  // circuit output: predicted_yield
        bool    isAboveThreshold = _pubSignals[1] == 1;  // circuit output: is_above_threshold
        uint256 threshold        = _pubSignals[2];  // circuit public input: threshold

        // ── Step 3: Sanity check ──────────────────────────────────────────────
        // The circuit already enforces this range constraint, but we add an on-chain
        // guard to defend against future circuit changes or implementation bugs.
        if (predictedYield > 10000) revert YieldOutOfRange(predictedYield);

        // ── Step 4: Store prediction ──────────────────────────────────────────
        predictionId = predictionCount++;

        Prediction memory pred = Prediction({
            predictedYield:   predictedYield,
            isAboveThreshold: isAboveThreshold,
            threshold:        threshold,
            submitter:        msg.sender,
            timestamp:        block.timestamp,
            blockNumber:      block.number
        });

        latestPrediction = pred;
        predictionHistory[predictionId] = pred;

        // ── Step 5: Emit event ────────────────────────────────────────────────
        // DeFi protocols listen to this event to trigger automated rebalancing.
        emit PredictionSubmitted(
            predictionId,
            predictedYield,
            isAboveThreshold,
            threshold,
            msg.sender,
            block.timestamp
        );
    }

    // ── View Functions ────────────────────────────────────────────────────────

    /**
     * @notice Get the most recent verified AI yield prediction.
     *
     * @return predictedYield    Yield in basis points (0-10000). Divide by 100 for %.
     * @return isAboveThreshold  Whether the prediction exceeds the oracle's threshold.
     * @return timestamp         Unix timestamp when this prediction was submitted.
     */
    function getLatestPrediction()
        external
        view
        returns (
            uint256 predictedYield,
            bool    isAboveThreshold,
            uint256 timestamp
        )
    {
        return (
            latestPrediction.predictedYield,
            latestPrediction.isAboveThreshold,
            latestPrediction.timestamp
        );
    }

    /**
     * @notice Get a specific historical prediction by ID.
     *
     * @param predictionId The sequential prediction ID (starts at 0)
     * @return The full Prediction struct
     */
    function getPrediction(uint256 predictionId)
        external
        view
        returns (Prediction memory)
    {
        if (predictionId >= predictionCount) {
            revert PredictionNotFound(predictionId);
        }
        return predictionHistory[predictionId];
    }

    /**
     * @notice Get a DeFi yield strategy recommendation based on the latest prediction.
     *
     * Strategy tiers (basis points):
     *   >= 800 bps (8%+)   → "aggressive"   — Leveraged LP on RSK DeFi protocols
     *   >= 500 bps (5-8%)  → "balanced"     — Standard lending on Tropykus/Sovryn
     *   >= 200 bps (2-5%)  → "conservative" — RBTC staking or stable lending
     *   <  200 bps (<2%)   → "idle"         — Hold RBTC; unfavorable conditions
     *
     * @return strategy  Strategy identifier string
     * @return yield     The predicted yield this recommendation is based on (bps)
     */
    function recommendStrategy()
        external
        view
        returns (string memory strategy, uint256 yield)
    {
        yield = latestPrediction.predictedYield;

        if (yield >= 800) {
            // High yield: take on more risk for maximum returns
            // Example: provide leveraged liquidity on Sovryn AMM
            strategy = "aggressive";
        } else if (yield >= 500) {
            // Moderate yield: balanced risk/reward
            // Example: standard lending on Tropykus
            strategy = "balanced";
        } else if (yield >= 200) {
            // Low yield: capital preservation with modest returns
            // Example: RBTC staking or stablecoin lending
            strategy = "conservative";
        } else {
            // Very low yield: stay in RBTC, wait for better conditions
            strategy = "idle";
        }
    }

    // ── Admin Functions ───────────────────────────────────────────────────────

    /**
     * @notice Add or remove an authorized proof submitter.
     * Only relevant when openSubmission is false.
     */
    function setAuthorizedSubmitter(address submitter, bool authorized)
        external
        onlyOwner
    {
        authorizedSubmitters[submitter] = authorized;
        emit SubmitterAuthorized(submitter, authorized);
    }

    /**
     * @notice Toggle open (permissionless) vs restricted submission.
     * In production, set to false and whitelist only trusted oracle agents.
     */
    function setOpenSubmission(bool isOpen) external onlyOwner {
        openSubmission = isOpen;
        emit OpenSubmissionToggled(isOpen);
    }

    /**
     * @notice Transfer contract ownership.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        require(newOwner != address(0), "Oracle: new owner is zero address");
        address old = owner;
        owner = newOwner;
        emit OwnershipTransferred(old, newOwner);
    }
}
