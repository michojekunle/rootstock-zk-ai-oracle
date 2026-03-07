# Llama AI Integration Guide

Your ZK Oracle agent is fully configured to use real Llama AI for BTC yield predictions. This guide explains how to set it up.

## Current Status

- ✅ **Agent Working**: Uses mock predictor (graceful fallback)
- ✅ **Testnet Deployed**: Successfully submitting proofs
- 🔄 **Llama Ready**: Can enable anytime by downloading a model

## Quick Start

### Option 1: Fast Setup (TinyLlama, ~400MB, 2-3 minutes)

```bash
bash scripts/setup-llama.sh tiny
```

Then edit `.env`:
```bash
# Uncomment this line:
LLAMA_MODEL_PATH=./models/tinyllama.Q4_K_M.gguf
```

Restart the agent:
```bash
node agent/index.js
```

You should see:
```
[Llama] Loading model from: ./models/tinyllama.Q4_K_M.gguf
[Llama] Model loaded successfully
[Step 1/3] AI Yield Prediction (Llama)
[Llama] Generating prediction...
[Llama] Prediction: 742 bps (7.42%)
```

### Option 2: Better Quality (Mistral 7B, ~5GB, 10-20 minutes)

```bash
bash scripts/setup-llama.sh mistral
```

Then edit `.env`:
```bash
LLAMA_MODEL_PATH=./models/mistral-7b.Q4_K_M.gguf
```

### Option 3: Best Quality (Llama 3.2 3B, ~2.3GB, 5-10 minutes)

```bash
bash scripts/setup-llama.sh llama
```

Then edit `.env`:
```bash
LLAMA_MODEL_PATH=./models/llama-3.2-3b.Q4_K_M.gguf
```

## Model Comparison

| Model | Size | Speed | Quality | Best For |
|-------|------|-------|---------|----------|
| **TinyLlama** | 400 MB | ~1s/pred | Good | Testing, development |
| **Mistral 7B** | 5 GB | ~3s/pred | Better | Production, accuracy |
| **Llama 3.2 3B** | 2.3 GB | ~2s/pred | Best | Production, best balance |

## Manual Download

If the script fails due to network issues, you can download manually:

**TinyLlama:**
```bash
mkdir -p models
curl -L -o models/tinyllama.Q4_K_M.gguf \
  "https://huggingface.co/TheBloke/TinyLlama-1.1B-Chat-v1.0-GGUF/resolve/main/tinyllama-1.1b-chat-v1.0.Q4_K_M.gguf?download=true"
```

**Mistral 7B:**
```bash
curl -L -o models/mistral-7b.Q4_K_M.gguf \
  "https://huggingface.co/TheBloke/Mistral-7B-Instruct-v0.2-GGUF/resolve/main/mistral-7b-instruct-v0.2.Q4_K_M.gguf?download=true"
```

**Llama 3.2 3B:**
```bash
curl -L -o models/llama-3.2-3b.Q4_K_M.gguf \
  "https://huggingface.co/QuantFactory/Meta-Llama-3.2-3B-Instruct-GGUF/resolve/main/Meta-Llama-3.2-3B-Instruct.Q4_K_M.gguf?download=true"
```

## How It Works

1. **Agent Starts**: Tries to load model from `LLAMA_MODEL_PATH`
2. **Model Loads**: If available, uses real Llama for predictions
3. **Fallback**: If model missing or path not set, uses mock predictor
4. **Same Output**: Both produce 0-10000 basis points (0-100% yield)
5. **Proof Works**: ZK circuit works with both real and mock predictions

## Verification

After enabling Llama, you should see in agent output:

```
[Llama] Model loaded successfully
[Step 1/3] AI Yield Prediction (Llama)
[Llama] Generating prediction...
[Llama] Prediction: XXX bps (X.XX%)
```

Instead of:
```
[Llama] LLAMA_MODEL_PATH not set. Using mock predictor.
[Llama-Mock] Predicted yield: XXX bps
```

## Performance Notes

- **First load**: Takes 10-30 seconds as model is loaded into memory
- **Subsequent predictions**: 1-5 seconds depending on model size
- **GPU support**: If you have NVIDIA CUDA installed, inference is faster
- **CPU only**: Works fine on modern CPUs

## Troubleshooting

**"Model not found" error**
- Check file exists: `ls -lh models/`
- Verify path in .env matches actual filename
- Download again if file is corrupted

**Agent still showing mock predictor**
- Restart agent: `node agent/index.js`
- Check .env file is saved with correct path
- Make sure path is uncommented (no leading `#`)

**Very slow predictions**
- Normal on CPU (1-5s per prediction depending on model)
- Consider using TinyLlama for faster predictions
- Check system resources (RAM, CPU not maxed)

## GPU Acceleration

To use NVIDIA CUDA for faster inference:

```bash
npm install cuda
# Then run with GPU enabled
CUDA_VISIBLE_DEVICES=0 node agent/index.js
```

For other GPUs (AMD, Apple Silicon), see [node-llama-cpp docs](https://github.com/withcatai/node-llama-cpp).

## Next Steps

1. Download a model: `bash scripts/setup-llama.sh tiny`
2. Uncomment `LLAMA_MODEL_PATH` in `.env`
3. Run agent: `node agent/index.js`
4. Watch real Llama predictions flow to testnet! 🚀

---

**Questions?** The agent works perfectly with the mock predictor too, so you can test everything without downloading a model. Enable Llama whenever you're ready!
