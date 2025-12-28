# Blockchain Setup Guide

This guide explains how to configure blockchain-related environment variables for Zentity's on-chain attestation feature.

---

## TL;DR - Local Development

**For local development, you need zero configuration to test wallet connection.**

Just run:

```bash
bun run dev
```

The app automatically uses a [public demo project ID](https://github.com/reown-com/web-examples) that only works on localhost.

### When Do You Need Full Setup?

| Goal | What You Need |
|------|---------------|
| Test wallet connection UI | Nothing (works out of the box) |
| Submit attestations to testnet | All variables below |
| Deploy to production | All variables below |

---

## Quick Reference

| Variable | Type | Where to Get It |
|----------|------|-----------------|
| `NEXT_PUBLIC_PROJECT_ID` | Public | [Reown Cloud Dashboard](#1-reown-appkit-project-id) |
| `FHEVM_REGISTRAR_PRIVATE_KEY` | Secret | [Create a new wallet](#2-registrar-wallet) |
| `LOCAL_REGISTRAR_PRIVATE_KEY` | Secret | [Create a new wallet](#2-registrar-wallet) |
| `FHEVM_RPC_URL` | Public | [fhEVM Network Config](#3-fhevm-network) |
| `FHEVM_NETWORK_ID` | Public | App network identifier (string) |
| `FHEVM_CHAIN_ID` | Public | EVM chain ID |
| `FHEVM_NETWORK_NAME` | Public | Display name |
| `FHEVM_EXPLORER_URL` | Public | Block explorer base URL |
| `FHEVM_IDENTITY_REGISTRY` | Public | [Deploy contracts](#4-contract-addresses) |
| `FHEVM_COMPLIANCE_RULES` | Public | [Deploy contracts](#4-contract-addresses) |

---

## 1. Reown AppKit Project ID

**Variable**: `NEXT_PUBLIC_PROJECT_ID`

Reown (formerly WalletConnect) requires a project ID to enable wallet connections.

### Steps

1. **Go to Reown Cloud**: <https://cloud.reown.com>

2. **Create an account** or sign in with your existing WalletConnect account

3. **Create a new project**:
   - Click **"Create Project"**
   - Enter your project name (e.g., "Zentity")
   - Click **Continue**

4. **Select product and framework**:
   - Product: **AppKit**
   - Framework: **Next.js**
   - Click **Create**

5. **Copy your Project ID**:
   - Find it in the top-left corner of your project dashboard
   - It looks like: `c4f79cc821944d9680842e34466bfb`

6. **Add to your `.env`**:

   ```bash
   NEXT_PUBLIC_PROJECT_ID=your-project-id-here
   ```

### Security Best Practice

Configure an **allowlist** in your Reown Cloud dashboard to prevent unauthorized use:

- For development: `localhost` is always allowed
- For production: Add your domain (e.g., `zentity.app`)

**Reference**: [Reown Documentation](https://docs.reown.com/cloud/relay)

---

## 2. Registrar Wallet

**Variables**: `FHEVM_REGISTRAR_PRIVATE_KEY`, `LOCAL_REGISTRAR_PRIVATE_KEY`

The registrar wallet is a server-side wallet that signs attestation transactions on behalf of verified users. You need to create a dedicated wallet for this purpose.
Use per-network keys so testnet and local workflows don't conflict. If you only use one
network, you can still set `REGISTRAR_PRIVATE_KEY` as a global fallback.

### Option A: Using MetaMask (Recommended for beginners)

1. **Install MetaMask**: <https://metamask.io/download/>

2. **Create a new account**:
   - Open MetaMask
   - Click the account selector (top center)
   - Click **"+ Add account or hardware wallet"**
   - Select **"Add a new Ethereum account"**
   - Name it "Zentity Registrar"

3. **Export the private key**:
   - Click the three dots (**...**) next to the account name
   - Select **"Account details"**
   - Click **"Show private key"**
   - Enter your MetaMask password
   - **Hold** the "Hold to reveal" button
   - Copy the private key (starts with `0x`)

4. **Add to your `.env`** (Sepolia/fhEVM):

   ```bash
   FHEVM_REGISTRAR_PRIVATE_KEY=<your_private_key_here>  # gitleaks:allow
   ```

**Reference**: [MetaMask: How to export a private key](https://support.metamask.io/configure/accounts/how-to-export-an-accounts-private-key/)

### Option B: Using Foundry Cast (Recommended for developers)

```bash
# Generate a new wallet
cast wallet new

# Output will show:
# Address:     0x...
# Private key: 0x...
```

Save the private key to your `.env` file.

**Reference**: [Foundry Book - cast wallet](https://book.getfoundry.sh/reference/cast/cast-wallet-new)

### Security Warnings

- **Never commit private keys** to version control
- **Use a dedicated wallet** - don't use your personal wallet
- **Keep minimal balance** - only enough for gas fees
- **Consider using a hardware wallet or KMS** for production

---

## 3. fhEVM Network

**Variables**: `FHEVM_RPC_URL` (and `NEXT_PUBLIC_FHEVM_RPC_URL` for client wallets)

Optional metadata (if you want to override defaults):
`FHEVM_NETWORK_ID`, `FHEVM_CHAIN_ID`, `FHEVM_NETWORK_NAME`, `FHEVM_EXPLORER_URL`
Optional provider selector:
`FHEVM_PROVIDER_ID` (defaults to `zama`; use `mock` for local Hardhat)

If you are running the frontend, mirror these as `NEXT_PUBLIC_*` so the client
wallet config stays aligned (e.g., `NEXT_PUBLIC_FHEVM_RPC_URL`).

The default FHEVM provider runs on Ethereum Sepolia testnet with additional FHE (Fully Homomorphic Encryption) capabilities. (Current provider: Zama fhEVM.)

### Network Configuration

| Setting | Value |
|---------|-------|
| Network Name | fhEVM (Sepolia) |
| RPC URL | `https://ethereum-sepolia-rpc.publicnode.com` |
| Chain ID | `11155111` |
| Currency | SepoliaETH |
| Explorer | <https://sepolia.etherscan.io> |
| Relayer/Gateway | Managed by the Zama relayer SDK (optional override via `NEXT_PUBLIC_FHEVM_RELAYER_URL` if endpoints change) |

### Add to MetaMask

1. Open MetaMask
2. Click the network selector (top left)
3. Click **"Add network"** > **"Add a network manually"**
4. Enter the values from the table above
5. Click **Save**

### Add to your `.env`

```bash
FHEVM_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
FHEVM_NETWORK_ID=fhevm_sepolia
FHEVM_CHAIN_ID=11155111
FHEVM_NETWORK_NAME="fhEVM (Sepolia)"
FHEVM_EXPLORER_URL=https://sepolia.etherscan.io
FHEVM_PROVIDER_ID=zama
NEXT_PUBLIC_FHEVM_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
NEXT_PUBLIC_FHEVM_NETWORK_ID=fhevm_sepolia
NEXT_PUBLIC_FHEVM_CHAIN_ID=11155111
NEXT_PUBLIC_FHEVM_NETWORK_NAME="fhEVM (Sepolia)"
NEXT_PUBLIC_FHEVM_EXPLORER_URL=https://sepolia.etherscan.io
NEXT_PUBLIC_FHEVM_PROVIDER_ID=zama
```

### Getting Testnet ETH

You need Sepolia ETH to pay for gas fees. Get free testnet ETH from these faucets:

| Faucet | URL | Notes |
|--------|-----|-------|
| Alchemy | <https://sepoliafaucet.com> | Free, requires account |
| QuickNode | <https://faucet.quicknode.com/ethereum/sepolia> | Free |
| Infura | <https://www.infura.io/faucet/sepolia> | Free, requires account |
| Google Cloud | <https://cloud.google.com/application/web3/faucet/ethereum/sepolia> | Free |
| LearnWeb3 | <https://learnweb3.io/faucets/sepolia> | Free |
| PoW Faucet | <https://sepolia-faucet.pk910.de> | Mine your own |

**Tip**: Fund your registrar wallet address with 0.1-0.5 SepoliaETH.

### FHEVM Protocol Contracts (Reference)

These are the provider's core infrastructure contracts (you don't need to deploy these). The addresses below are for the current Zama fhEVM deployment:

| Contract | Address |
|----------|---------|
| ACL | `0xf0Ffdc93b7E186bC2f8CB3dAA75D86d1930A433D` |
| KMS Verifier | `0xbE0E383937d564D7FF0BC3b46c51f0bF8d5C311A` |
| Input Verifier | `0xBBC1fFCdc7C316aAAd72E807D9b0272BE8F84DA0` |

**Reference**: [FHEVM Protocol Documentation (Zama)](https://docs.zama.org/protocol/solidity-guides/smart-contract/configure/contract_addresses)

---

## 4. Contract Addresses

**Variables**: `FHEVM_IDENTITY_REGISTRY`, `FHEVM_COMPLIANCE_RULES`

These are the Zentity smart contracts that you deploy. They store encrypted identity attestations on-chain.

### Deploy Contracts

From the `zentity-fhevm-contracts` repository:

```bash
cd path/to/zentity-fhevm-contracts

# Install dependencies
npm install

# Set your private key
export PRIVATE_KEY=0x...your-registrar-private-key

# Deploy to fhEVM Sepolia
npx hardhat run scripts/deploy.ts --network fhevmSepolia
```

The deploy script will output (example):

```text
IdentityRegistry deployed to: 0x05c6FB879BbF0Cab2B0206523583F94E49Ba62e2
ComplianceRules deployed to: 0x78dE340fc7A6ba470a5dD8b0a5f5933cD48dC164
```

### Add to your `.env`

```bash
FHEVM_IDENTITY_REGISTRY=0x05c6FB879BbF0Cab2B0206523583F94E49Ba62e2  # From deploy output
FHEVM_COMPLIANCE_RULES=0x78dE340fc7A6ba470a5dD8b0a5f5933cD48dC164   # From deploy output
```

### Verify Contracts (Optional)

```bash
npx hardhat verify --network fhevmSepolia 0x1234...
```

---

## 5. Local Development (Optional)

For local development without testnet, you can use Hardhat.

### Start Local Node

```bash
cd path/to/zentity-fhevm-contracts
npx hardhat node
```

### Deploy Locally

```bash
npx hardhat run scripts/deploy.ts --network localhost
```

### Configure Zentity

```bash
NEXT_PUBLIC_ENABLE_HARDHAT=true
LOCAL_RPC_URL=http://127.0.0.1:8545
LOCAL_IDENTITY_REGISTRY=0x...  # From deploy output
LOCAL_COMPLIANCE_RULES=0x...   # From deploy output
```

---

## Complete Example `.env`

```bash
# =============================================================================
# Blockchain Configuration
# =============================================================================

# Reown AppKit (Wallet Connection)
# Get from: https://cloud.reown.com
NEXT_PUBLIC_PROJECT_ID=c4f79cc821944d9680842e34466bfb

# Registrar Wallet (server-side signing)
# Export from MetaMask or generate with: cast wallet new
FHEVM_REGISTRAR_PRIVATE_KEY=<your_private_key_here>  # gitleaks:allow
LOCAL_REGISTRAR_PRIVATE_KEY=<your_private_key_here>  # gitleaks:allow

# Network Feature Flags
NEXT_PUBLIC_ENABLE_FHEVM=true
NEXT_PUBLIC_ENABLE_HARDHAT=false

# fhEVM Sepolia
FHEVM_RPC_URL=https://ethereum-sepolia-rpc.publicnode.com
FHEVM_IDENTITY_REGISTRY=0x...  # Your deployed contract
FHEVM_COMPLIANCE_RULES=0x...   # Your deployed contract
```

---

## Troubleshooting

### "Insufficient funds" error

Your registrar wallet needs Sepolia ETH for gas. Use a faucet to get testnet tokens.

### "Invalid project ID" error

Double-check your `NEXT_PUBLIC_PROJECT_ID` from Reown Cloud. Make sure there are no extra spaces.

### Wallet won't connect

1. Check that you're on the correct network (Sepolia)
2. Verify your project ID has the correct allowlist in Reown Cloud
3. Clear your browser cache and try again

### Transaction stuck

Sepolia can be slow. Wait a few minutes or check the transaction on [Etherscan](https://sepolia.etherscan.io).

---

## Resources

- [Reown Cloud Dashboard](https://cloud.reown.com)
- [Reown AppKit Docs](https://docs.reown.com/appkit/next/core/installation)
- [MetaMask Private Key Export](https://support.metamask.io/configure/accounts/how-to-export-an-accounts-private-key/)
- [FHEVM Documentation (Zama)](https://docs.zama.org/protocol)
- [FHEVM Contract Addresses (Zama)](https://docs.zama.org/protocol/solidity-guides/smart-contract/configure/contract_addresses)
- [Sepolia Faucets](https://sepoliafaucet.com)
- [Foundry Book](https://book.getfoundry.sh)
