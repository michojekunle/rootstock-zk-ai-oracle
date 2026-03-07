/**
 * app.js
 *
 * Main application logic for the ZK Oracle dApp.
 * Handles wallet connection, contract interaction, and event listening.
 */

import config from "./config.js";
import { ORACLE_ABI } from "./utils/oracle-abi.js";

// Global state
let provider = null;
let signer = null;
let oracle = null;
let currentChainId = null;
const eventHistory = [];

/**
 * Initialize the app
 */
export async function initApp() {
  const connectBtn = document.getElementById("connectBtn");
  connectBtn.addEventListener("click", handleConnectWallet);

  // Check if wallet is already connected (metamask refresh, etc)
  if (window.ethereum) {
    try {
      const accounts = await window.ethereum.request({ method: "eth_accounts" });
      if (accounts.length > 0) {
        await connectWallet();
      }
    } catch (err) {
      // Silent fail - not connected yet
    }
  }
}

/**
 * Handle connect wallet button click
 */
async function handleConnectWallet() {
  if (!window.ethereum) {
    showError("MetaMask or Rabby wallet not detected. Please install it first.");
    return;
  }

  try {
    await connectWallet();
  } catch (err) {
    showError(`Connection failed: ${err.message}`);
  }
}

/**
 * Connect to wallet
 */
async function connectWallet() {
  try {
    // Request account access
    const accounts = await window.ethereum.request({
      method: "eth_requestAccounts",
    });

    if (!accounts || accounts.length === 0) {
      throw new Error("No accounts returned from wallet");
    }

    // Create provider and signer
    provider = new ethers.BrowserProvider(window.ethereum);
    signer = await provider.getSigner();
    const network = await provider.getNetwork();
    currentChainId = Number(network.chainId);

    // Check if network is supported
    if (!config.SUPPORTED_CHAINS.includes(currentChainId)) {
      showError(
        `Network not supported. Please switch to Rootstock testnet (chainId 31) or localhost (31337)`
      );
      return;
    }

    // Get Oracle contract address
    const oracleAddress = config.ORACLE_ADDRESS[currentChainId];
    if (!oracleAddress || oracleAddress.includes("0x...")) {
      showError(
        `Oracle address not configured for this network. Update dapp-frontend/config.js with the deployment address.`
      );
      return;
    }

    // Load Oracle contract
    oracle = new ethers.Contract(oracleAddress, ORACLE_ABI, provider);

    // Update UI
    document.getElementById("connectBtn").disabled = true;
    document.getElementById("networkInfo").classList.remove("hidden");
    document.getElementById("chainName").textContent = config.CHAIN_NAMES[currentChainId];
    document.getElementById("chainId").textContent = currentChainId;
    document.getElementById("walletAddress").textContent = accounts[0];
    document.getElementById("oracleSection").classList.remove("hidden");
    document.getElementById("errorContainer").classList.add("hidden");

    // Load initial data
    await loadLatestPrediction();

    // Start listening for events
    listenForNewPredictions();
  } catch (err) {
    showError(`Wallet connection failed: ${err.message}`);
  }
}

/**
 * Load and display the latest prediction from Oracle
 */
async function loadLatestPrediction() {
  try {
    const pred = await oracle.latestPrediction();
    const yieldBps = Number(pred.predictedYield);
    const yieldPercent = (yieldBps / 100).toFixed(2);
    const isAboveThreshold = pred.isAboveThreshold;
    const timestamp = new Date(Number(pred.timestamp) * 1000).toLocaleString();

    // Get strategy recommendation
    let strategy = "idle";
    if (yieldBps >= 800) strategy = "aggressive";
    else if (yieldBps >= 500) strategy = "balanced";
    else if (yieldBps >= 200) strategy = "conservative";

    // Update UI
    document.getElementById("yieldValue").textContent = `${yieldBps}`;
    document.getElementById("percentValue").textContent = `${yieldPercent}`;
    document.getElementById("aboveValue").textContent = isAboveThreshold ? "YES ✓" : "NO ✗";

    const strategyBadge = document.getElementById("strategyBadge");
    strategyBadge.textContent = strategy.toUpperCase();
    strategyBadge.className = `strategy-badge ${strategy}`;

    document.getElementById("timestampValue").textContent = timestamp;

    // Update strategy explanation
    const strategyInfo = config.STRATEGY_TIERS[strategy];
    document.getElementById("strategyExplanation").textContent = strategyInfo.description;
  } catch (err) {
    console.error("Failed to load prediction:", err);
  }
}

/**
 * Listen for new PredictionSubmitted events
 */
function listenForNewPredictions() {
  if (!oracle) return;

  oracle.on(
    "PredictionSubmitted",
    async (predictionId, yield_, isAbove, threshold, submitter, timestamp) => {
      const yieldBps = Number(yield_);
      const yieldPercent = (yieldBps / 100).toFixed(2);
      const timestampStr = new Date(Number(timestamp) * 1000).toLocaleString();
      const submitterShort = `${submitter.slice(0, 6)}...${submitter.slice(-4)}`;

      // Add to history
      eventHistory.unshift({
        id: Number(predictionId),
        yield: yieldBps,
        percent: yieldPercent,
        isAbove,
        threshold: Number(threshold),
        timestamp: timestampStr,
        submitter: submitterShort,
      });

      // Keep only last 20 events
      if (eventHistory.length > 20) {
        eventHistory.pop();
      }

      // Update UI
      updatePredictionHistory();

      // Reload latest prediction
      await loadLatestPrediction();
    }
  );
}

/**
 * Update the prediction history display
 */
function updatePredictionHistory() {
  const historyDiv = document.getElementById("predictionHistory");

  if (eventHistory.length === 0) {
    historyDiv.innerHTML = '<p class="placeholder">No predictions yet</p>';
    return;
  }

  historyDiv.innerHTML = eventHistory
    .map(
      (evt) => `
    <div class="history-item">
      <div class="history-item-header">
        #${evt.id} • ${evt.yield} bps (${evt.percent}%) • ${evt.isAbove ? "✓ Above" : "✗ Below"} ${evt.threshold}
      </div>
      <div class="history-item-detail">Submitter: ${evt.submitter}</div>
      <div class="history-item-detail">${evt.timestamp}</div>
    </div>
  `
    )
    .join("");
}

/**
 * Show error message
 */
function showError(message) {
  const errorContainer = document.getElementById("errorContainer");
  const errorMessage = document.getElementById("errorMessage");

  errorMessage.textContent = message;
  errorContainer.classList.remove("hidden");

  // Auto-hide after 8 seconds
  setTimeout(() => {
    errorContainer.classList.add("hidden");
  }, 8000);
}

// Initialize on page load
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initApp);
} else {
  initApp();
}
