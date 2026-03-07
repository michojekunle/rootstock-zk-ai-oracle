#!/bin/bash
# setup-llama.sh
# Download and configure a Llama model for the ZK Oracle agent
#
# Usage: bash scripts/setup-llama.sh [model-size]
#   model-size: tiny (default), mistral, or llama (best quality)

set -e

MODEL_SIZE="${1:-tiny}"
MODELS_DIR="./models"

mkdir -p "$MODELS_DIR"

echo "═══════════════════════════════════════════════════════════════════════════════"
echo "  ZK Oracle — Llama Model Setup"
echo "═══════════════════════════════════════════════════════════════════════════════"
echo ""

case "$MODEL_SIZE" in
  tiny)
    echo "Downloading TinyLlama 1.1B (Q4_K_M, ~400MB)..."
    echo "Speed: Fast | Quality: Good for testing | Time: ~2-3 minutes"
    echo ""
    URL="https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf?download=true"
    FILE="$MODELS_DIR/tinyllama.Q4_K_M.gguf"
    MODEL_PATH="./models/tinyllama.Q4_K_M.gguf"
    ;;
  mistral)
    echo "Downloading Mistral 7B (Q4_K_M, ~5GB)..."
    echo "Speed: Slower | Quality: Better | Time: ~10-20 minutes"
    echo ""
    URL="https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF/resolve/main/mistral-7b-instruct-v0.2.Q4_K_M.gguf?download=true"
    FILE="$MODELS_DIR/mistral-7b.Q4_K_M.gguf"
    MODEL_PATH="./models/mistral-7b.Q4_K_M.gguf"
    ;;
  llama)
    echo "Downloading Llama 3.2 3B (Q4_K_M, ~2.3GB)..."
    echo "Speed: Medium | Quality: Best | Time: ~5-10 minutes"
    echo ""
    URL="https://huggingface.co/QuantFactory/Meta-Llama-3.2-3B-Instruct-GGUF/resolve/main/Meta-Llama-3.2-3B-Instruct.Q4_K_M.gguf?download=true"
    FILE="$MODELS_DIR/llama-3.2-3b.Q4_K_M.gguf"
    MODEL_PATH="./models/llama-3.2-3b.Q4_K_M.gguf"
    ;;
  *)
    echo "Invalid model size. Choose: tiny, mistral, or llama"
    exit 1
    ;;
esac

# Download using curl
echo "Starting download..."
if curl -L -o "$FILE" "$URL"; then
  echo ""
  echo "✓ Download complete!"
  FILE_SIZE=$(du -h "$FILE" | cut -f1)
  echo "  File: $FILE"
  echo "  Size: $FILE_SIZE"
  echo ""
  echo "Next step: Update .env"
  echo "───────────────────────────────────────────────────────────────────────────────"
  echo "Edit .env and uncomment:"
  echo ""
  echo "  LLAMA_MODEL_PATH=$MODEL_PATH"
  echo ""
  echo "Then run the agent:"
  echo ""
  echo "  node agent/index.js"
  echo ""
  echo "═══════════════════════════════════════════════════════════════════════════════"
else
  echo "✗ Download failed. Check your connection and try again."
  exit 1
fi
