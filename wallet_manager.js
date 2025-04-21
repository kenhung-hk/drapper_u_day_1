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

// Function to get a private key from a mnemonic
function getPrivateKeyFromMnemonic(mnemonic) {
  try {
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
    
    return accountKey;
  } catch (error) {
    console.error('Error getting private key from mnemonic:', error);
    throw error;
  }
}

// Function to send ADA from one wallet to another
async function sendAda(senderWallet, receiverAddress, amountAda) {
  try {
    console.log(`\n💸 Attempting to send ${amountAda} ADA from ${senderWallet.name} to address ${receiverAddress}`);
    
    // Get sender's private key from mnemonic
    const accountKey = getPrivateKeyFromMnemonic(senderWallet.mnemonic);
    
    // Derive spending key
    const spendingKey = accountKey
      .derive(0) // role: 0 (external addresses)
      .derive(0) // index: 0 (first address)
      .to_public();
    
    // Get the stake key
    const stakeKey = accountKey
      .derive(2) // role: 2 (staking key)
      .derive(0) // index: 0
      .to_public();
    
    // Convert ADA to lovelace
    const amountLovelace = Math.floor(amountAda * 1000000);
    
    // Fee buffer in lovelace (minimum fee + buffer)
    const feeBuffer = 200000; // 0.2 ADA
    
    // Get UTXOs for the sender's address
    const utxos = await blockfrostAPI.addressesUtxos(senderWallet.address);
    
    if (!utxos || utxos.length === 0) {
      console.log(`❌ No UTXOs found for address ${senderWallet.address}`);
      return false;
    }
    
    // Create transaction inputs
    const txInputs = CardanoWasm.TransactionInputs.new();
    let totalInputAmount = 0;
    
    for (const utxo of utxos) {
      const txInput = CardanoWasm.TransactionInput.new(
        CardanoWasm.TransactionHash.from_bytes(
          Buffer.from(utxo.tx_hash, 'hex')
        ),
        utxo.output_index
      );
      
      txInputs.add(txInput);
      
      // Add up input values (lovelace)
      const lovelace = utxo.amount.find(a => a.unit === 'lovelace')?.quantity || '0';
      totalInputAmount += parseInt(lovelace);
      
      // Break if we have enough inputs for our transaction
      if (totalInputAmount >= amountLovelace + feeBuffer) {
        break;
      }
    }
    
    if (totalInputAmount < amountLovelace + feeBuffer) {
      console.log(`❌ Not enough funds. Required: ${(amountLovelace + feeBuffer)/1000000} ADA, Available: ${totalInputAmount/1000000} ADA`);
      return false;
    }
    
    // Create transaction outputs
    const txOutputs = CardanoWasm.TransactionOutputs.new();
    
    // Output to recipient
    const recipientAddress = CardanoWasm.Address.from_bech32(receiverAddress);
    const recipientOutput = CardanoWasm.TransactionOutput.new(
      recipientAddress,
      CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(amountLovelace.toString()))
    );
    txOutputs.add(recipientOutput);
    
    // Calculate change amount (sending back to sender)
    const changeAmount = totalInputAmount - amountLovelace - feeBuffer;
    
    if (changeAmount > 0) {
      const senderAddress = CardanoWasm.Address.from_bech32(senderWallet.address);
      const changeOutput = CardanoWasm.TransactionOutput.new(
        senderAddress,
        CardanoWasm.Value.new(CardanoWasm.BigNum.from_str(changeAmount.toString()))
      );
      txOutputs.add(changeOutput);
    }
    
    // Get latest protocol parameters
    const latestBlock = await blockfrostAPI.blocksLatest();
    const latestSlot = latestBlock.slot;
    const protocolParams = await blockfrostAPI.epochsParameters(latestBlock.epoch);
    
    // Create transaction body
    const txBody = CardanoWasm.TransactionBody.new(
      txInputs,
      txOutputs,
      CardanoWasm.BigNum.from_str(feeBuffer.toString()),
      latestSlot + 10000 // TTL: current slot + 10000 slots
    );
    
    // Create witnesses
    const witnesses = CardanoWasm.TransactionWitnessSet.new();
    
    // Add spending key witness
    const vkeyWitnesses = CardanoWasm.Vkeywitnesses.new();
    const txBodyHash = CardanoWasm.hash_transaction(txBody);
    
    const spendingPrivateKey = accountKey
      .derive(0) // role: 0 (external)
      .derive(0); // index: 0
    
    const vkeyWitness = CardanoWasm.make_vkey_witness(txBodyHash, spendingPrivateKey.to_raw_key());
    vkeyWitnesses.add(vkeyWitness);
    witnesses.set_vkeys(vkeyWitnesses);
    
    // Create signed transaction
    const transaction = CardanoWasm.Transaction.new(
      txBody,
      witnesses,
      undefined // No metadata
    );
    
    // Serialize transaction to CBOR bytes
    const txBytes = transaction.to_bytes();
    const txHex = Buffer.from(txBytes).toString('hex');
    
    // Submit transaction
    console.log(`Submitting transaction...`);
    const submittedTxHash = await blockfrostAPI.txSubmit(Buffer.from(txBytes));
    
    console.log(`✅ Transaction submitted successfully!`);
    console.log(`Transaction hash: ${submittedTxHash}`);
    
    return true;
  } catch (error) {
    console.error('Error sending ADA:', error);
    return false;
  }
}

// Function to check balances and transfer 1 ADA if one wallet has more funds
async function balanceCheckAndTransfer(wallets) {
  try {
    if (!wallets || wallets.length < 2) {
      console.log('Need at least 2 wallets to check balances');
      return false;
    }
    
    // Get balances for each wallet
    const walletsWithBalance = [];
    
    for (const wallet of wallets) {
      const balance = await fetchBalance(wallet.address);
      
      walletsWithBalance.push({
        ...wallet,
        balance: {
          ada: parseFloat(balance.ada),
          lovelace: balance.lovelace
        }
      });
    }
    
    // Sort wallets by balance (descending)
    walletsWithBalance.sort((a, b) => b.balance.ada - a.balance.ada);
    
    // Check if the first wallet has more balance than the second
    if (walletsWithBalance[0].balance.ada > walletsWithBalance[1].balance.ada) {
      console.log(`\n💹 ${walletsWithBalance[0].name} has more ADA (${walletsWithBalance[0].balance.ada}) than ${walletsWithBalance[1].name} (${walletsWithBalance[1].balance.ada})`);
      
      // Send 1 ADA from wallet with more balance to wallet with less balance
      const success = await sendAda(
        walletsWithBalance[0],
        walletsWithBalance[1].address,
        1.0 // 1 ADA
      );
      
      if (success) {
        console.log(`\n✅ Successfully sent 1 ADA from ${walletsWithBalance[0].name} to ${walletsWithBalance[1].name}`);
      } else {
        console.log(`\n❌ Failed to send 1 ADA from ${walletsWithBalance[0].name} to ${walletsWithBalance[1].name}`);
      }
      
      return success;
    } else {
      console.log(`\n🔄 No transfer needed. ${walletsWithBalance[0].name} (${walletsWithBalance[0].balance.ada} ADA) does not have more than ${walletsWithBalance[1].name} (${walletsWithBalance[1].balance.ada} ADA)`);
      return false;
    }
  } catch (error) {
    console.error('Error checking balances and transferring:', error);
    return false;
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
    
    // Check balances and transfer if needed
    await balanceCheckAndTransfer(existingWallets);
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
    
    console.log(`\n⚠️ New wallets created. Fund them first before attempting transfers.`);
  }
}

// Export the main function
export { manageWallets };