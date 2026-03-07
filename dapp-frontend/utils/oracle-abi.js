/**
 * oracle-abi.js
 *
 * Oracle contract ABI for ethers.js
 *
 * SETUP:
 * 1. After running `npm run compile:contracts`, an ABI is generated at:
 *    ../artifacts/contracts/Oracle.sol/Oracle.json
 *
 * 2. Copy the "abi" field from that JSON file and paste it below:
 */

// TODO: Replace this with the actual Oracle ABI from artifacts/contracts/Oracle.sol/Oracle.json
// For now, here's a minimal ABI to get started. Copy the full ABI after compilation.
export const ORACLE_ABI = [
  {
    inputs: [],
    name: "latestPrediction",
    outputs: [
      { name: "predictedYield", type: "uint256" },
      { name: "isAboveThreshold", type: "bool" },
      { name: "timestamp", type: "uint256" },
    ],
    stateMutability: "view",
    type: "function",
  },
  {
    inputs: [{ name: "yield_", type: "uint256" }],
    name: "recommendStrategy",
    outputs: [{ name: "", type: "string" }],
    stateMutability: "pure",
    type: "function",
  },
  {
    anonymous: false,
    inputs: [
      { indexed: true, name: "predictionId", type: "uint256" },
      { indexed: false, name: "predictedYield", type: "uint256" },
      { indexed: false, name: "isAboveThreshold", type: "bool" },
      { indexed: false, name: "threshold", type: "uint256" },
      { indexed: true, name: "submitter", type: "address" },
      { indexed: false, name: "timestamp", type: "uint256" },
    ],
    name: "PredictionSubmitted",
    type: "event",
  },
];
