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
  creatorVaultPda,
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
    const creatorVault = creatorVaultPda(cfgPda);
    const vaultBal = await connection.getBalance(creatorVault);
    // Only pull when accumulated fees are worth the gas (> 0.003 SOL)
    if (vaultBal < 3_000_000) return;

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

const PASSENGERS = [
  "HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM", // Architect (Semir)
  "ANteYDsqEktuCdzNRa4v56Rax1z8z3RbUJnB24Ru1WkK", // Deployer
  "6KytvLy6PZ44Uv4eg1wmVNsJZ5B3qUcZaURzathjcBUK", // Pilot (Trader A)
  "FZZ67edJikzEk2mH8exEG9vbgfonW96snwh1b9QhijC8", // First Class (Trader C)
  "7LuuDws4TsPmQ4G7LyreJzECH6HhMd5vsTC179Acw9n8"  // Cabin (Trader D)
];
const INCINERATOR = new PublicKey("1nc1nerator11111111111111111111111111111111");

async function checkPotAndSettle() {
  try {
    // 1. Pull accumulated creator fees from Pump.fun vault
    await pullCreatorFees();

    const potBalance = await connection.getBalance(potPubkey);
    console.log(`[Heartbeat] Pot Balance: ${(potBalance / 1e9).toFixed(4)} SOL`);

    // Only settle if there is accumulating fuel (> 0.0035 SOL, leaving 0.002 rent reserve)
    if (potBalance > 3_500_000) {
      console.log(`🚨 REDLINE HIT! Settling Round #${currentRound}...`);
      const available = potBalance - 2_000_000; // leave 0.002 SOL rent buffer
      const burnAmount = Math.floor(available * 0.50);
      const airdropAmount = available - burnAmount;
      const perWallet = Math.floor(airdropAmount / PASSENGERS.length);

      console.log(` -> 50% Burn: ${(burnAmount / 1e9).toFixed(5)} SOL to 1nc1nerator`);
      console.log(` -> 50% Top 5 Airdrop: ${(airdropAmount / 1e9).toFixed(5)} SOL (${(perWallet / 1e9).toFixed(5)} SOL each)`);

      // Execute Transfers (Pot signs directly)
      const tx = new Transaction();
      // 1. Transfer 50% to Solana Incinerator
      tx.add(
        SystemProgram.transfer({
          fromPubkey: potPubkey,
          toPubkey: INCINERATOR,
          lamports: burnAmount,
        })
      );
      // 2. Transfer 50% split across 5 passengers
      for (const p of PASSENGERS) {
        tx.add(
          SystemProgram.transfer({
            fromPubkey: potPubkey,
            toPubkey: new PublicKey(p),
            lamports: perWallet,
          })
        );
      }

      const sig = await sendAndConfirmTransaction(connection, tx, [potKeypair], { skipPreflight: true });
      console.log("✅ REDLINE SETTLED ON-CHAIN! Payout Confirmed! Tx:", sig);

      // Progressive Timer Extension (10% growth up to 24 hours)
      currentRound++;
      currentDuration = Math.min(Math.floor(currentDuration * 1.1), MAX_DURATION);
      console.log(`⏱️ Next Round #${currentRound} Target Fuse: ${currentDuration}s`);
    } else {
      console.log("Fuel below threshold, awaiting trading volume...");
    }
  } catch (err) {
    console.error("Crank check error:", err.message);
  }

  // Reschedule next check (every 12 seconds)
  setTimeout(checkPotAndSettle, 12000);
}

// Start loop
checkPotAndSettle();
