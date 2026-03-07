/**
 * llama-predictor.js
 *
 * Real Llama AI model integration for BTC yield prediction.
 * Replaces the mock predictor with actual LLM inference.
 *
 * Setup:
 *   npm install node-llama-cpp
 *   npx node-llama-cpp pull --dir ./models llama3.2:3b
 *   Set LLAMA_MODEL_PATH in .env
 */

let llamaSession = null;
let modelPath = null;

/**
 * Initialize the Llama model on startup.
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

    // Try v2.x API first (current version)
    try {
      const { Llama, LlamaChatSession } = await import("node-llama-cpp");
      const llama = new Llama({
        model: path,
      });

      llamaSession = new LlamaChatSession({
        model: llama,
      });

      modelPath = path;
      console.log("[Llama] Model loaded successfully");
      return;
    } catch (_v2Err) {
      // Fallback to older API if v2.x doesn't work
      const { getLlama, LlamaChatSession } = await import("node-llama-cpp");
      const llama = await getLlama();
      const model = await llama.loadModel({ modelPath: path });
      const context = await model.createContext();

      llamaSession = new LlamaChatSession({
        contextSequence: context.getSequence(),
      });

      modelPath = path;
      console.log("[Llama] Model loaded successfully");
    }
  } catch (err) {
    console.warn(`[Llama] Failed to load model: ${err.message}`);
    console.warn("[Llama] Falling back to mock predictor");
    llamaSession = null;
  }
}

/**
 * Get a BTC yield prediction from the Llama model.
 *
 * Llama analyzes market data (price, volume, volatility, dominance) and predicts
 * the expected DeFi lending yield in basis points (0-10000, where 100 = 1%).
 *
 * @param {Array} btcHistory - Array of market data objects with: price, volume, volatility, dominance
 * @returns {Promise<number>} - Predicted yield in basis points (0-10000)
 * @throws {Error} - If model is not initialized and fallback is disabled
 */
export async function llamaPredict(btcHistory) {
  if (!llamaSession) {
    console.warn("[Llama] Model not loaded. Use initLlama() or provide LLAMA_MODEL_PATH in .env");
    throw new Error(
      "Llama model not initialized. Run: npm install node-llama-cpp && npx node-llama-cpp pull --dir ./models llama3.2:3b"
    );
  }

  // Format market data for the prompt
  const marketData = btcHistory
    .map(
      (d, i) =>
        `[${i}] Price: $${d.price}, Volume: ${d.volume}M, Volatility: ${(d.volatility * 100).toFixed(1)}%, Dominance: ${d.dominance.toFixed(1)}%`
    )
    .join("\n");

  const prompt = `You are an expert BTC DeFi yield predictor. Analyze this Bitcoin market data and predict the expected DeFi lending yield.

Market Data (7 data points, latest = most recent):
${marketData}

Based on this data:
1. Assess market momentum (price trend)
2. Evaluate market confidence (volume, volatility)
3. Consider BTC narrative strength (dominance)
4. Predict realistic DeFi lending yield

Return ONLY a single integer between 0 and 10000 representing basis points (100 = 1% yield).
No explanation, no text, just the number.`;

  try {
    console.log("[Llama] Generating prediction...");
    const response = await llamaSession.prompt(prompt);
    const prediction = parseInt(response.trim());

    // Validate the prediction is in range
    if (isNaN(prediction) || prediction < 0 || prediction > 10000) {
      throw new Error(
        `Invalid prediction from Llama: got "${response.trim()}", expected integer 0-10000`
      );
    }

    console.log(`[Llama] Prediction: ${prediction} bps (${(prediction / 100).toFixed(2)}%)`);
    return prediction;
  } catch (err) {
    throw new Error(`Llama prediction failed: ${err.message}`);
  }
}

/**
 * Check if Llama model is available.
 *
 * @returns {boolean} - True if model is loaded and ready
 */
export function isLlamaReady() {
  return llamaSession !== null;
}

/**
 * Get the path to the currently loaded model.
 *
 * @returns {string|null} - Model path or null if not loaded
 */
export function getLlamaModelPath() {
  return modelPath;
}
