import { manageWallets } from './wallet_manager.js';

// Run the wallet manager
manageWallets()
  .then(() => {
    console.log('\n✅ Wallet management completed');
  })
  .catch(error => {
    console.error('\n❌ Error running wallet manager:', error);
  }); 