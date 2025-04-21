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
  network: network, // Using preprod network
});

// Function to create a Cardano wallet from a mnemonic
function createCardanoWallet(mnemonic = null) {
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
    
    // Create an address using spending and stake keys
    const baseAddr = CardanoWasm.BaseAddress.new(
      CardanoWasm.NetworkInfo.mainnet().network_id(),
      CardanoWasm.StakeCredential.from_keyhash(spendingKey.to_raw_key().hash()),
      CardanoWasm.StakeCredential.from_keyhash(stakeKey.to_raw_key().hash())
    );
    
    // Convert to a bech32 format address
    const address = baseAddr.to_address().to_bech32();
    
    // Return wallet information
    return {
      mnemonic,
      address,
      type: 'Mainnet Address'
    };
  } catch (error) {
    console.error('Error creating wallet:', error);
    throw error;
  }
}

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

// Function to fetch UTXOs for a given address
async function fetchUTXOs(address) {
  try {
    // Verify we have an API key
    if (!blockfrostAPI.projectId || blockfrostAPI.projectId === '') {
      console.log(`⚠️ Skipping UTXO lookup: No Blockfrost API key`);
      return [];
    }
    
    // Check if the address exists first to avoid errors
    try {
      const addressInfo = await blockfrostAPI.addresses(address);
      
      // If the address has no transactions, it may not have UTXOs
      if (addressInfo.tx_count === 0) {
        return [];
      }
    } catch (error) {
      if (error.status_code === 404) {
        // Address not found/used yet
        return [];
      }
      throw error;
    }
    
    // Fetch UTXOs
    const utxos = await blockfrostAPI.addressesUtxos(address);
    
    // Format UTXOs
    return utxos.map(utxo => {
      // Calculate ADA amount from lovelace
      const lovelace = utxo.amount.find(a => a.unit === 'lovelace')?.quantity || '0';
      const adaAmount = parseInt(lovelace) / 1000000;
      
      // Get other assets if any
      const assets = utxo.amount
        .filter(a => a.unit !== 'lovelace')
        .map(a => ({
          unit: a.unit,
          quantity: a.quantity
        }));
      
      return {
        txHash: utxo.tx_hash,
        outputIndex: utxo.output_index,
        lovelace,
        ada: adaAmount.toFixed(6),
        assets: assets.length > 0 ? assets : null
      };
    });
  } catch (error) {
    console.error(`Error fetching UTXOs for ${address}:`, error);
    return [];
  }
}

// Function to generate multiple wallets with different names and fetch their UTXOs
async function generateWalletSet(prefix) {
  const wallets = [];
  
  // Define wallet types to create
  const walletTypes = [
    // Gas tank wallet
    'gas-tank',
    
    // Operator wallets 1-3 (simplified from the original 10)
    ...Array.from({ length: 3 }, (_, i) => `operator-${i+1}`),
    
    // ADA Holding Wallets
    ...Array.from({ length: 2 }, (_, i) => `ada-holding-${i+1}`)
  ];
  
  for (const walletType of walletTypes) {
    const walletName = `${prefix}${walletType}`;
    
    // Create testnet wallet
    const walletData = createTestnetWallet();
    
    console.log(`\n📬 Generated preprod testnet wallet for ${walletName}:`);
    console.log(`Address: ${walletData.address}`);
    console.log(`🔑 Seed Phrase (KEEP SECURE):\n${walletData.mnemonic}`);
    
    // Fetch UTXOs
    const utxos = await fetchUTXOs(walletData.address);
    console.log(`\n💰 UTXOs (${utxos.length}):`);
    
    if (utxos.length === 0) {
      console.log('  None found - this is likely a new wallet');
    } else {
      utxos.forEach((utxo, index) => {
        console.log(`  UTXO #${index+1}:`);
        console.log(`    TX Hash: ${utxo.txHash}`);
        console.log(`    Output Index: ${utxo.outputIndex}`);
        console.log(`    Amount: ${utxo.ada} ADA`);
        
        if (utxo.assets) {
          console.log('    Native Assets:');
          utxo.assets.forEach(asset => {
            console.log(`      ${asset.unit}: ${asset.quantity}`);
          });
        }
      });
    }
    
    console.log('---------------------------------------------------');
    
    wallets.push({
      name: walletName,
      address: walletData.address,
      network: 'preprod',
      utxoCount: utxos.length,
      balance: utxos.reduce((total, utxo) => total + parseFloat(utxo.ada), 0).toFixed(6)
    });
  }
  
  return wallets;
}

// Main function to generate wallets
async function generateWallets() {
  console.log('===== Generating Cardano Wallets for Preprod Testnet =====');
  console.log(`Network: ${network}`);
  
  console.log('\nGenerating preprod testnet wallets...');
  const wallets = await generateWalletSet('preprod_');
  
  // Output summary
  console.log('\n===== Wallet Generation Summary =====');
  
  console.log('\nPreprod Testnet Wallets:');
  wallets.forEach(wallet => {
    console.log(`${wallet.name}: ${wallet.address} (Balance: ${wallet.balance} ADA)`);
  });
  
  console.log('\n⚠️ IMPORTANT: Save the seed phrases securely. Anyone with access to them can control your funds!');
  
  return wallets;
}

// Generate wallets
generateWallets()
  .then(wallets => {
    console.log('\n✅ All preprod testnet wallets generated successfully!');
  })
  .catch(error => {
    console.error('Error generating wallets:', error);
    process.exit(1);
  });
