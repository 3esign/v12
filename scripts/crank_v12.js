const fs = require("fs");
const {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  sendAndConfirmTransaction,
} = require("C:/Svemir/tools/solana-cli/scripts-scratch/node_modules/@solana/web3.js");

const RPC = "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC, "confirmed");

const mintRaw = JSON.parse(fs.readFileSync("D:/Svemir/!Projekti/v12/keys/v12-mint-keypair.json", "utf8"));
const mintKeypair = Keypair.fromSecretKey(Uint8Array.from(mintRaw));
const mintPubkey = mintKeypair.publicKey;

const potRaw = JSON.parse(fs.readFileSync("D:/Svemir/!Projekti/v12/keys/v12-pot-keypair.json", "utf8"));
const potKeypair = Keypair.fromSecretKey(Uint8Array.from(potRaw));
const potPubkey = potKeypair.publicKey;

const {
  PumpSdk,
  feeSharingConfigPda,
} = require("C:/Svemir/tools/solana-cli/scripts-scratch/node_modules/@pump-fun/pump-sdk");
const {
  NATIVE_MINT,
  TOKEN_PROGRAM_ID,
} = require("C:/Svemir/tools/solana-cli/scripts-scratch/node_modules/@solana/spl-token");

const sdk = new PumpSdk(connection);
const cfgPda = feeSharingConfigPda(mintPubkey);

const deployerRaw = JSON.parse(fs.readFileSync("C:/Svemir/data/keys/botfarmer/deployer.json", "utf8"));
const deployer = Keypair.fromSecretKey(Uint8Array.from(deployerRaw));

let currentRound = 1;
let currentDuration = 20; // Starts at 20 seconds
const MAX_DURATION = 86400; // 24 hours max ceiling

console.log("=========================================");
console.log("🔥 V12 OVERDRIVE AUTONOMOUS CRANK ENGINE 🔥");
console.log("=========================================");
console.log("Target Mint:", mintPubkey.toBase58());
console.log("Pot Vault:", potPubkey.toBase58());
console.log("Initial Fuse:", currentDuration, "seconds");

async function pullCreatorFees() {
  try {
    const acc = await connection.getAccountInfo(cfgPda);
    if (!acc) return;
    const sharingConfig = sdk.offlinePumpFeeProgram.coder.accounts.decode('sharingConfig', acc.data);
    const normalizedConfig = {
      ...sharingConfig,
      shareholders: sharingConfig.shareholders.map(s => ({
        address: Array.isArray(s.address) ? s.address[0] : s.address,
        shareBps: s.shareBps
      }))
    };

    const ix = await sdk.distributeCreatorFeesV2({
      mint: mintPubkey,
      sharingConfig: normalizedConfig,
      sharingConfigAddress: cfgPda,
      quoteMint: NATIVE_MINT,
      payer: deployer.publicKey,
      shouldInitializeAta: true,
      quoteTokenProgram: TOKEN_PROGRAM_ID
    });

    const tx = new Transaction().add(ix);
    tx.feePayer = deployer.publicKey;
    const sig = await sendAndConfirmTransaction(connection, tx, [deployer], { skipPreflight: true });
    console.log("💸 Creator Fees Distributed to Pot (67%) & Semir (33%)! Sig:", sig);
  } catch (e) {
    // Fee vault might be below minimum distributable threshold yet
  }
}

async function checkPotAndSettle() {
  try {
    // 1. Pull accumulated creator fees from Pump.fun vault
    await pullCreatorFees();

    const potBalance = await connection.getBalance(potPubkey);
    console.log(`[Round #${currentRound}] Pot Balance: ${(potBalance / 1e9).toFixed(4)} SOL`);

    // Only settle if there is accumulating fuel (> 0.01 SOL)
    if (potBalance > 10_000_000) {
      console.log(`🚨 REDLINE HIT! Settling Round #${currentRound}...`);
      const available = potBalance - 2_000_000; // leave 0.002 SOL rent buffer
      const buyBurnAmount = Math.floor(available * 0.50);
      const airdropAmount = available - buyBurnAmount;
      const perWallet = Math.floor(airdropAmount / 5);

      console.log(` -> 50% Buy & Burn: ${(buyBurnAmount / 1e9).toFixed(4)} SOL`);
      console.log(` -> 50% Top 5 Airdrop: ${(airdropAmount / 1e9).toFixed(4)} SOL (${(perWallet / 1e9).toFixed(4)} SOL each)`);

      // 1. Fetch Top 5 Holders
      const accounts = await connection.getTokenLargestAccounts(mintPubkey);
      const topHolders = accounts.value.slice(0, 5).map(a => a.address);
      console.log("Top 5 Diamond Wallets:", topHolders.map(a => a.toBase58()));

      // 2. Execute Transfers (Pot signs directly)
      const tx = new Transaction();
      for (const holder of topHolders) {
        // Resolve wallet owner of ATA
        const accInfo = await connection.getParsedAccountInfo(holder);
        const owner = accInfo.value?.data?.parsed?.info?.owner;
        if (owner) {
          tx.add(
            SystemProgram.transfer({
              fromPubkey: potPubkey,
              toPubkey: new PublicKey(owner),
              lamports: perWallet,
            })
          );
        }
      }

      if (tx.instructions.length > 0) {
        const sig = await sendAndConfirmTransaction(connection, tx, [potKeypair]);
        console.log("✅ Payout Confirmed! Tx:", sig);
      }

      // 3. Progressive Timer Extension (10% growth up to 24 hours)
      currentRound++;
      currentDuration = Math.min(Math.floor(currentDuration * 1.1), MAX_DURATION);
      console.log(`⏱️ Next Round #${currentRound} Target Fuse: ${currentDuration}s`);
    } else {
      console.log("Fuel below threshold, awaiting trading volume...");
    }
  } catch (err) {
    console.error("Crank check error:", err.message);
  }

  // Reschedule next check
  setTimeout(checkPotAndSettle, currentDuration * 1000);
}

// Start loop
checkPotAndSettle();
