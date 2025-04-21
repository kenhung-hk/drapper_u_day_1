# Cardano Wallet Generator

A simple Node.js script to generate Cardano wallets and seed phrases using Blockfrost API and Lucid library.

## Setup

1. Clone this repository
2. Install dependencies:
   ```
   npm install
   ```
3. Get a Blockfrost API key from [blockfrost.io](https://blockfrost.io/)
4. Create a `.env` file based on `.env.example`:
   ```
   cp .env.example .env
   ```
5. Edit the `.env` file and add your Blockfrost API key

## Usage

Run the script:

```
npm start
```

The script will:
1. Generate a new seed phrase (mnemonic)
2. Derive a private key from the seed phrase
3. Generate a wallet address
4. Display the seed phrase and wallet address

⚠️ **IMPORTANT**: Store your seed phrase securely. Anyone with access to your seed phrase can access your funds!

## Networks

You can change the Cardano network by setting the `NETWORK` environment variable in the `.env` file:
- `mainnet` - Main Cardano network
- `preprod` - Pre-production test network
- `preview` - Preview test network 