import fs from 'fs';
import dotenv from 'dotenv';
import bip39 from 'bip39';
import * as CardanoWasm from '@emurgo/cardano-serialization-lib-nodejs';
import { BlockFrostAPI } from '@blockfrost/blockfrost-js';

dotenv.config();

// Network configuration
const network = process.env.NETWORK || 'preprod';

// Initialize Blockfrost API
const blockfrostAPI = new BlockFrostAPI({
  projectId: process.env.BLOCKFROST_API_KEY || '',
  network: network,
});

// File path to store wallet information
const WALLET_FILE = 'wallets.txt';

// Function to create a testnet wallet
function createTestnetWallet(mnemonic = null) {
  try {
    // Generate a new mnemonic if one isn't provided
    if (!mnemonic) {
      // Generate a 24-word mnemonic (256 bits of entropy)
      mnemonic = bip39.generateMnemonic(256);
    }

    // Convert the mnemonic to a seed
    const seed = bip39.mnemonicToEntropy(mnemonic);
    
    // Derive private key from the seed
    const rootKey = CardanoWasm.Bip32PrivateKey.from_bip39_entropy(
      Buffer.from(seed, 'hex'),
      Buffer.from('') // No password
    );
    
    // Derive account key (path: m/1852'/1815'/0')
    const accountKey = rootKey
      .derive(1852 + 0x80000000) // purpose: 1852'
      .derive(1815 + 0x80000000) // coin type: 1815' (ADA)
      .derive(0 + 0x80000000);   // account: 0'
    
    // Generate a stake key
    const stakeKey = accountKey
      .derive(2) // role: 2 (staking key)
      .derive(0) // index: 0
      .to_public();
      
    // Generate a spending key
    const spendingKey = accountKey
      .derive(0) // role: 0 (external addresses)
      .derive(0) // index: 0 (first address)
      .to_public();
    
    // Create an address using spending and stake keys - using testnet network ID
    const baseAddr = CardanoWasm.BaseAddress.new(
      CardanoWasm.NetworkInfo.testnet().network_id(),
      CardanoWasm.StakeCredential.from_keyhash(spendingKey.to_raw_key().hash()),
      CardanoWasm.StakeCredential.from_keyhash(stakeKey.to_raw_key().hash())
    );
    
    // Convert to a bech32 format address
    const address = baseAddr.to_address().to_bech32();
    
    // Return wallet information
    return {
      mnemonic,
      address,
      type: 'Testnet Address'
    };
  } catch (error) {
    console.error('Error creating testnet wallet:', error);
    throw error;
  }
}

// Function to fetch balance for a given address
async function fetchBalance(address) {
  try {
    // Verify we have an API key
    if (!blockfrostAPI.projectId || blockfrostAPI.projectId === '') {
      console.log(`⚠️ Skipping balance lookup: No Blockfrost API key`);
      return { ada: '0', lovelace: '0' };
    }
    
    try {
      // Get address info which includes total balance
      const addressInfo = await blockfrostAPI.addresses(address);
      
      // Calculate ADA from lovelace
      const lovelace = addressInfo.amount.find(a => a.unit === 'lovelace')?.quantity || '0';
      const adaAmount = parseInt(lovelace) / 1000000;
      
      return {
        lovelace,
        ada: adaAmount.toFixed(6)
      };
    } catch (error) {
      if (error.status_code === 404) {
        // Address not found/used yet
        return { ada: '0', lovelace: '0' };
      }
      throw error;
    }
  } catch (error) {
    console.error(`Error fetching balance for ${address}:`, error);
    return { ada: '0', lovelace: '0' };
  }
}

// Function to save wallets to a file
function saveWalletsToFile(wallets) {
  try {
    const walletsData = wallets.map(wallet => {
      return {
        name: wallet.name,
        address: wallet.address,
        mnemonic: wallet.mnemonic,
        type: wallet.type
      };
    });
    
    fs.writeFileSync(WALLET_FILE, JSON.stringify(walletsData, null, 2));
    console.log(`Wallets saved to ${WALLET_FILE}`);
  } catch (error) {
    console.error('Error saving wallets to file:', error);
  }
}

// Function to load wallets from a file
function loadWalletsFromFile() {
  try {
    if (fs.existsSync(WALLET_FILE)) {
      const walletsData = fs.readFileSync(WALLET_FILE, 'utf8');
      return JSON.parse(walletsData);
    }
    return null;
  } catch (error) {
    console.error('Error loading wallets from file:', error);
    return null;
  }
}

// Main function to create or load wallets and check balances
async function manageWallets() {
  console.log(`\n🔍 Checking if wallet file exists...`);
  
  // Try to load existing wallets
  const existingWallets = loadWalletsFromFile();
  
  if (existingWallets) {
    console.log(`✅ Found existing wallets in ${WALLET_FILE}`);
    
    // Check balance for each wallet
    for (const wallet of existingWallets) {
      console.log(`\n📬 Wallet: ${wallet.name || 'Unnamed wallet'}`);
      console.log(`Address: ${wallet.address}`);
      
      // Fetch and display balance
      const balance = await fetchBalance(wallet.address);
      console.log(`💰 Balance: ${balance.ada} ADA (${balance.lovelace} lovelace)`);
    }
  } else {
    console.log(`❌ No existing wallets found. Creating 2 new wallets...`);
    
    // Create 2 new wallets
    const wallets = [
      { ...createTestnetWallet(), name: 'Wallet 1' },
      { ...createTestnetWallet(), name: 'Wallet 2' }
    ];
    
    // Save the wallets to file
    saveWalletsToFile(wallets);
    
    // Display wallet info
    for (const wallet of wallets) {
      console.log(`\n📬 Created new wallet: ${wallet.name}`);
      console.log(`Address: ${wallet.address}`);
      console.log(`🔑 Seed Phrase (KEEP SECURE):\n${wallet.mnemonic}`);
      console.log(`💰 Balance: 0 ADA (new wallet)`);
    }
  }
}

// Export the main function
export { manageWallets }; 