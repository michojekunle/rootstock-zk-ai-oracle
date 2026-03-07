# ZK-Private AI Oracle — Frontend dApp

A minimal web interface for querying the ZK-Private AI Oracle smart contract on **Rootstock Testnet**.

> ✅ **Testnet-First Setup** — This dApp is configured for Rootstock testnet (chainId 31) as the primary deployment target. Local hardhat development is optional.

## Features

- 🔗 **Wallet Connection** — Connect MetaMask or Rabby to any supported network
- 📊 **Live Prediction Display** — Shows the current BTC yield prediction and strategy recommendation
- 🔄 **Real-Time Updates** — Listens for new predictions and updates the UI automatically
- 📜 **Prediction History** — View recent predictions submitted to the Oracle
- 🎨 **Responsive Design** — Works on desktop, tablet, and mobile devices
- ⚡ **No Build Required** — Pure vanilla JavaScript with ethers.js v6

## Setup

### 1. Deploy Smart Contracts (Rootstock Testnet)

Deploy the Oracle contracts to Rootstock testnet:

```bash
# From the project root
npm run compile:circuit
npm run compile:contracts
npm run deploy:testnet
```

**Important:** Make sure your `.env` file has a funded Rootstock testnet account (get tRBTC from https://faucet.rootstock.io).

### 2. Update Contract Address for Testnet

After deployment, copy the Oracle address from `deployments.json` to `dapp-frontend/config.js`:

```bash
# Find the Oracle address in deployments.json
cat deployments.json
# Copy the "oracle" value
```

Edit `dapp-frontend/config.js` and paste:

```javascript
ORACLE_ADDRESS: {
  31: "0xPASTE_YOUR_TESTNET_ORACLE_ADDRESS_HERE",  // From npm run deploy:testnet
  30: "0x...",                                       // Optional: mainnet later
}
```

### 3. Update Oracle ABI

After compiling contracts, export the Oracle ABI to the dApp:

```bash
# The ABI is generated at:
# artifacts/contracts/Oracle.sol/Oracle.json

# Copy the "abi" array from that file to:
# dapp-frontend/utils/oracle-abi.js
```

Open `artifacts/contracts/Oracle.sol/Oracle.json`, copy the "abi" array, and paste it into `dapp-frontend/utils/oracle-abi.js`:

```javascript
export const ORACLE_ABI = [
  // Paste the abi array here
];
```

### 4. Start the Dev Server

```bash
cd dapp-frontend
python3 -m http.server 8000
# Or with Node.js: npx http-server .
# Or with Node.js simple server: node -e "require('http').createServer((req,res) => { res.writeHead(200); res.end(require('fs').readFileSync(req.url.slice(1)||'index.html')); }).listen(8000); console.log('Server running at http://localhost:8000');"
```

### 5. Open in Browser

```
http://localhost:8000
```

## Usage

1. **Connect Wallet** — Click "Connect MetaMask / Rabby" and approve the connection
2. **Select Network** — Make sure MetaMask is set to **Rootstock Testnet** (chainId 31)
   - If not already added, add it manually:
     - **Name:** Rootstock Testnet
     - **RPC URL:** https://public-node.testnet.rsk.co
     - **Chain ID:** 31
     - **Currency:** tRBTC
3. **View Prediction** — The current prediction from the Oracle is displayed
4. **Watch Events** — New predictions appear in real-time as they're submitted
5. **Check Strategy** — The strategy recommendation is based on the yield tier:
   - 🟢 **Aggressive** ≥ 800 bps (≥ 8%)
   - 🔵 **Balanced** ≥ 500 bps (≥ 5%)
   - 🟠 **Conservative** ≥ 200 bps (≥ 2%)
   - ⚫ **Idle** < 200 bps (< 2%)

## Project Structure

```
dapp-frontend/
├── index.html          # Main page template
├── app.js              # ethers.js logic (wallet connection, events)
├── style.css           # Styling (responsive, dark theme)
├── config.js           # Network and contract configuration
├── utils/
│   └── oracle-abi.js   # Oracle contract ABI (from artifacts)
└── README.md           # This file
```

## Configuration

Edit `config.js` to:

- **Add contract addresses** — Paste Oracle address from `deployments.json`
- **Add supported networks** — Change `SUPPORTED_CHAINS` for different networks
- **Customize strategy descriptions** — Update `STRATEGY_TIERS` with your own logic

## Troubleshooting

### "Oracle address not configured"

**Problem:** Error says Oracle address is not configured.

**Solution:**
1. Run `npm run deploy:testnet` to deploy to Rootstock testnet
2. Copy the Oracle address from `deployments.json`
3. Paste it into `dapp-frontend/config.js` with chainId 31

### "MetaMask not detected"

**Problem:** dApp says MetaMask is not installed.

**Solution:**
1. Install MetaMask: https://metamask.io
2. Or install Rabby wallet: https://rabby.io
3. Refresh the page

### "Network not supported"

**Problem:** dApp says your network is not supported.

**Solution:**
1. Switch your wallet to **Rootstock Testnet** (chainId 31)
2. If the network isn't in MetaMask, add it manually:
   - **Name:** Rootstock Testnet
   - **RPC URL:** https://public-node.testnet.rsk.co
   - **Chain ID:** 31
   - **Currency:** tRBTC

### No predictions showing

**Problem:** The dApp connects but shows "Listening for new predictions..."

**Solution:**
1. Run the agent to submit a prediction: `node agent/index.js`
2. Or check that the Oracle is deployed and accessible
3. Check browser console (F12 → Console) for errors

## Development

### Add New Features

1. **Add a new tool button** — Edit `index.html`
2. **Handle the button click** — Add event listener in `app.js`
3. **Call Oracle method** — Use `oracle.yourMethod()`
4. **Update UI** — Modify the DOM elements

### Modify Styling

Edit `style.css` to customize the appearance. The design uses CSS variables:

```css
:root {
  --primary: #667eea;      /* Main color (buttons, highlights) */
  --success: #10b981;      /* Green (aggressive strategy) */
  --warning: #f59e0b;      /* Orange (conservative strategy) */
  --danger: #ef4444;       /* Red (errors) */
}
```

### Deploy to Production

The dApp is a static site. Deploy to any static host:

```bash
# GitHub Pages
# Push to GitHub Pages branch or use Actions

# Vercel
vercel --prod dapp-frontend

# Netlify
netlify deploy --prod --dir dapp-frontend
```

## Supported Networks

| Network | Chain ID | RPC | Status |
|---------|----------|-----|--------|
| **Rootstock Testnet** | **31** | **https://public-node.testnet.rsk.co** | **✓ Primary** |
| Rootstock Mainnet | 30 | https://public-node.rsk.co | ✓ Mainnet (add address) |
| Hardhat Local (optional) | 31337 | http://127.0.0.1:8545 | ✓ Local dev |

## Security

⚠️ **Important Notes:**

- This is a **read-only** dApp (no private key submission)
- All wallet interactions use MetaMask/Rabby (keys stay in wallet)
- No contract ABI or addresses are hardcoded from deployment
- Suitable for public, mainnet deployment on GitHub Pages, Vercel, or Netlify

## Resources

- [ethers.js v6 Docs](https://docs.ethers.org/v6/)
- [MetaMask Docs](https://docs.metamask.io/)
- [Rootstock Docs](https://docs.rootstock.io/)
- [Explorer](https://explorer.testnet.rootstock.io/)

## License

MIT
