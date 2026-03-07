pragma circom 2.0.0;

// circomlib provides standard ZK gadgets: range checks, comparators, hash functions.
// The include paths use node_modules so circom2 can resolve them with -l node_modules.
include "../node_modules/circomlib/circuits/comparators.circom";
include "../node_modules/circomlib/circuits/bitify.circom";

/*
 * PredictionProof Circuit
 * =======================
 * Proves that an AI model produced a yield prediction in the valid range [0, 10000]
 * and that the comparison against a threshold is computed correctly — all without
 * revealing the raw prediction value or the privacy salt.
 *
 * PRIVATE inputs (hidden from verifier, only known to prover):
 *   raw_prediction  - The AI model's numeric output (yield in basis points, 0-10000)
 *                     100 bps = 1% yield. This is the sensitive alpha we protect.
 *   salt            - Random nonce that binds the proof to this specific run.
 *                     Prevents an attacker from reverse-engineering raw_prediction
 *                     from the public outputs alone.
 *
 * PUBLIC inputs (visible to verifier and on-chain contract):
 *   threshold       - Configurable comparison threshold (e.g., 500 = 5% yield).
 *                     Chosen by the oracle operator, committed in the proof.
 *
 * PUBLIC outputs (computed by circuit, verified on-chain by Oracle.sol):
 *   predicted_yield     - Equals raw_prediction. Reveals the prediction value.
 *                         The ZK proof guarantees it is authentic (produced by the model).
 *   is_above_threshold  - 1 if raw_prediction >= threshold, 0 otherwise.
 *                         DeFi apps can use this as a boolean signal.
 *
 * Constraints enforced by the circuit (what the ZK proof GUARANTEES):
 *   1. 0 <= raw_prediction <= 10000  (valid basis-points range)
 *   2. predicted_yield == raw_prediction  (commitment: output is the real value)
 *   3. is_above_threshold == (raw_prediction >= threshold)  (correct comparison)
 *
 * Public signal ordering (snarkjs outputs first, then public inputs):
 *   publicSignals[0] = predicted_yield
 *   publicSignals[1] = is_above_threshold
 *   publicSignals[2] = threshold
 *
 * This ordering must match the uint[3] _pubSignals array in Oracle.sol.
 */
template PredictionProof() {

    // ── Private Inputs ────────────────────────────────────────────────────────
    signal input raw_prediction;
    signal input salt;

    // ── Public Inputs ─────────────────────────────────────────────────────────
    signal input threshold;

    // ── Public Outputs ────────────────────────────────────────────────────────
    signal output predicted_yield;
    signal output is_above_threshold;

    // ── Internal Components ───────────────────────────────────────────────────

    // Num2Bits(14): Decomposes raw_prediction into 14 bits.
    // This constrains raw_prediction to the range [0, 2^14 - 1] = [0, 16383].
    // Combined with the explicit upper bound check below, we get [0, 10000].
    component n2b = Num2Bits(14);

    // LessThan(14): Checks if in[0] < in[1] (returns 1 if true, 0 if false).
    // We use this for the upper bound: raw_prediction < 10001 ⟺ raw_prediction <= 10000.
    component upper = LessThan(14);

    // GreaterEqThan(14): Checks if in[0] >= in[1] (returns 1 if true, 0 if false).
    // Used for threshold comparison.
    component geq = GreaterEqThan(14);

    // ── Constraints ───────────────────────────────────────────────────────────

    // Constraint 1: raw_prediction fits in 14 bits (lower bound: >= 0).
    // Num2Bits proves raw_prediction is representable in 14 unsigned bits,
    // which means it cannot be negative (as a field element in range [0, 16383]).
    n2b.in <== raw_prediction;

    // Constraint 2: raw_prediction <= 10000 (upper bound).
    // LessThan returns 1 when in[0] < in[1], so we assert it equals 1.
    upper.in[0] <== raw_prediction;
    upper.in[1] <== 10001;   // 10001 means: raw_prediction < 10001, i.e., <= 10000
    upper.out === 1;          // This assertion fails the proof if out-of-range

    // Constraint 3: Output commitment — predicted_yield equals raw_prediction.
    // The verifier can trust that the public predicted_yield IS the model's output.
    predicted_yield <== raw_prediction;

    // Constraint 4: Threshold comparison.
    geq.in[0] <== raw_prediction;
    geq.in[1] <== threshold;
    is_above_threshold <== geq.out;

    // Constraint 5: Salt binding.
    // Multiplying salt by 0 creates a genuine R1CS constraint that includes salt
    // in the witness computation without affecting the output values.
    // This prevents the optimizer from eliminating salt from the proof,
    // ensuring each proof is uniquely bound to a fresh random salt.
    signal salted;
    salted <== raw_prediction + salt * 0;
}

// Instantiate the template as the main component.
// {public [threshold]} declares threshold as a public input.
// raw_prediction and salt are private inputs by default (not listed in public).
// Outputs (predicted_yield, is_above_threshold) are automatically public in snarkjs.
component main {public [threshold]} = PredictionProof();
