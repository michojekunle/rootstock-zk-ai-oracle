/**
 * llama-predictor.js
 *
 * Real Llama AI model integration for BTC yield prediction.
 * Uses node-llama-cpp v2.8.16+ with proper context initialization
 *
 * Setup:
 *   npm install node-llama-cpp
 *   Download model: bash scripts/setup-llama.sh tiny
 *   Uncomment LLAMA_MODEL_PATH in .env
 */

let llamaModel = null;
let modelPath = null;

/**
 * Initialize the Llama model on startup.
 * Uses node-llama-cpp v2.8.16+ API properly
 *
 * @param {string} path - Path to the GGUF model file
 * @returns {Promise<void>}
 */
export async function initLlama(path) {
  if (!path) {
    console.log("[Llama] LLAMA_MODEL_PATH not set. Using mock predictor instead.");
    return;
  }

  try {
    console.log(`[Llama] Loading model from: ${path}`);

    // node-llama-cpp v2.8.16: Load the model
    const { LlamaModel } = await import("node-llama-cpp");

    llamaModel = new LlamaModel({
      modelPath: path,
      numGpuLayers: 35,  // Offload to GPU if available
    });

    modelPath = path;
    console.log("[Llama] Model loaded successfully");
  } catch (err) {
    console.warn(`[Llama] Failed to load model: ${err.message}`);
    console.warn("[Llama] Falling back to mock predictor");
    llamaModel = null;
  }
}

/**
 * Get a BTC yield prediction from the Llama model.
 *
 * Uses node-llama-cpp generate() method for inference.
 * Analyzes market data and predicts DeFi lending yield (0-10000 basis points).
 *
 * @param {Array} btcHistory - Array of market data objects
 * @returns {Promise<number>} - Predicted yield in basis points
 */
export async function llamaPredict(btcHistory) {
  if (!llamaModel) {
    throw new Error("Llama model not loaded. Run: bash scripts/setup-llama.sh tiny");
  }

  // Format market data
  const marketData = btcHistory
    .map(
      (d, i) =>
        `[${i}] $${d.price} | Vol:${d.volume}M | Vol%:${(d.volatility * 100).toFixed(1)} | Dom:${d.dominance.toFixed(1)}%`
    )
    .join("\n");

  // Simple, direct prompt for better inference
  const prompt = `Predict BTC DeFi yield (0-10000 basis points) based on this market data:
${marketData}

Consider: momentum, volume confidence, volatility risk, BTC dominance.
Return ONLY the number, nothing else.`;

  try {
    console.log("[Llama] Generating prediction...");

    // Use the model's generate method directly
    const response = await llamaModel.generate({
      prompt,
      maxTokens: 20,
      temperature: 0.1,  // Low temperature for more deterministic output
    });

    // Extract the response text
    const responseText = response.trim();
    const prediction = parseInt(responseText.match(/\d+/)?.[0] || "0");

    // Validate range
    if (isNaN(prediction) || prediction < 0 || prediction > 10000) {
      throw new Error(
        `Invalid response: "${responseText}" parsed to ${prediction}`
      );
    }

    console.log(`[Llama] Prediction: ${prediction} bps (${(prediction / 100).toFixed(2)}%)`);
    return prediction;
  } catch (err) {
    throw new Error(`Llama inference failed: ${err.message}`);
  }
}

/**
 * Check if Llama model is available and ready.
 *
 * @returns {boolean} - True if model is loaded
 */
export function isLlamaReady() {
  return llamaModel !== null;
}

/**
 * Get the path to the currently loaded model.
 *
 * @returns {string|null} - Model path or null if not loaded
 */
export function getLlamaModelPath() {
  return modelPath;
}
