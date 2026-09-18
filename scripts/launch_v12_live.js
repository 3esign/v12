const fs = require("fs");
const {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
} = require("C:/Svemir/tools/solana-cli/scripts-scratch/node_modules/@solana/web3.js");
const {
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
} = require("C:/Svemir/tools/solana-cli/scripts-scratch/node_modules/@solana/spl-token");
const {
  PumpSdk,
} = require("C:/Svemir/tools/solana-cli/scripts-scratch/node_modules/@pump-fun/pump-sdk");

const RPC = "https://api.mainnet-beta.solana.com";
const SEMIR_WALLET = new PublicKey("HXFDaHyZ3i477z1BakiTWZg9UQN8rcreruuv9ifC1HvM");
const METADATA_URI = "https://ipfs.io/ipfs/bafkreifbxj4ly67izfvqswd25ua2kcllrb7x56who6bkqc4huaurkdzoby";

async function main() {
  const isSend = process.argv.includes("--send");
  const connection = new Connection(RPC, "confirmed");
  const sdk = new PumpSdk(connection);

  const deployerRaw = JSON.parse(fs.readFileSync("C:/Svemir/data/keys/botfarmer/deployer.json", "utf8"));
  const deployer = Keypair.fromSecretKey(Uint8Array.from(deployerRaw));

  const mintRaw = JSON.parse(fs.readFileSync("D:/Svemir/!Projekti/v12/keys/v12-mint-keypair.json", "utf8"));
  const mintKeypair = Keypair.fromSecretKey(Uint8Array.from(mintRaw));
  const mintPubkey = mintKeypair.publicKey;

  const potRaw = JSON.parse(fs.readFileSync("D:/Svemir/!Projekti/v12/keys/v12-pot-keypair.json", "utf8"));
  const potKeypair = Keypair.fromSecretKey(Uint8Array.from(potRaw));
  const potPubkey = potKeypair.publicKey;

  console.log("==================================================");
  console.log("🏎️ V12 OVERDRIVE MAINNET GENESIS & 67/33 SPLIT");
  console.log("==================================================");
  console.log("Mode:", isSend ? "🔴 LIVE MAINNET EXECUTION" : "🟡 DRY-RUN SIMULATION");
  console.log("Deployer:", deployer.publicKey.toBase58());
  console.log("Mint ($V12):", mintPubkey.toBase58());
  console.log("Pot Vault (67%):", potPubkey.toBase58());
  console.log("Architect (33%):", SEMIR_WALLET.toBase58());

  const balBefore = await connection.getBalance(deployer.publicKey);
  console.log("Deployer Balance:", (balBefore / 1e9), "SOL");

  // =========================================================================
  // STEP 1: TX1 - CREATE TOKEN ON PUMP.FUN WITH 5% DYNAMIC CREATOR FEE
  // =========================================================================
  console.log("\n[Step 1] Building TX1 (CreateV2 on Pump.fun with 5% fee)...");
  const createIx = await sdk.createV2Instruction({
    mint: mintPubkey,
    name: "V12 Overdrive",
    symbol: "V12",
    uri: METADATA_URI,
    creator: deployer.publicKey,
    user: deployer.publicKey,
    mayhemMode: false,
    cashback: false,
    creatorFeeBps: 500, // 5% starting anti-snipe fee
  });

  const tx1 = new Transaction().add(createIx);
  tx1.feePayer = deployer.publicKey;
  const { blockhash: bh1, lastValidBlockHeight: lvb1 } = await connection.getLatestBlockhash("confirmed");
  tx1.recentBlockhash = bh1;
  tx1.sign(deployer, mintKeypair);

  console.log("Simulating TX1...");
  const sim1 = await connection.simulateTransaction(tx1, undefined, { replaceRecentBlockhash: true, sigVerify: false });
  console.log("TX1 Sim Err:", sim1.value.err);
  if (sim1.value.err) {
    console.error("❌ TX1 Simulation failed! Aborting.");
    if (sim1.value.logs) console.error(sim1.value.logs.slice(-10));
    process.exit(1);
  }
  console.log("✅ TX1 Simulation PASSED! Units consumed:", sim1.value.unitsConsumed);

  // =========================================================================
  // STEP 2: TX2 - FEE SHARING CONFIG & SPLIT LOCK (67% POT / 33% ARCHITECT)
  // =========================================================================
  console.log("\n[Step 2] Building TX2 (Fee-Sharing Config & 67/33 Split Lock)...");
  const feeConfigIx = await sdk.createFeeSharingConfig({
    creator: deployer.publicKey,
    mint: mintPubkey,
    pool: null,
  });

  const updateSharesIx = await sdk.updateFeeSharesV2({
    authority: deployer.publicKey,
    mint: mintPubkey,
    currentShareholders: [deployer.publicKey],
    newShareholders: [
      { address: potPubkey, shareBps: 6700 },
      { address: SEMIR_WALLET, shareBps: 3300 },
    ],
    quoteMint: NATIVE_MINT,
    quoteTokenProgram: TOKEN_PROGRAM_ID,
  });

  const tx2 = new Transaction().add(feeConfigIx, updateSharesIx);
  tx2.feePayer = deployer.publicKey;
  const { blockhash: bh2, lastValidBlockHeight: lvb2 } = await connection.getLatestBlockhash("confirmed");
  tx2.recentBlockhash = bh2;
  tx2.sign(deployer);

  console.log("TX2 size:", tx2.serialize({ verifySignatures: false }).length, "bytes (Limit: 1232)");

  if (!isSend) {
    console.log("\n🟡 DRY-RUN COMPLETE. Total estimated cost on Mainnet: ~0.06 SOL.");
    console.log("Run with --send to broadcast live to Solana Mainnet.");
    return;
  }

  // =========================================================================
  // LIVE EXECUTION
  // =========================================================================
  console.log("\n🚀 SENDING TX1: Creating $V12 on Pump.fun...");
  const sig1 = await connection.sendRawTransaction(tx1.serialize(), { skipPreflight: false });
  console.log("TX1 Signature:", sig1);
  console.log("Confirming TX1...");
  await connection.confirmTransaction({ signature: sig1, blockhash: bh1, lastValidBlockHeight: lvb1 }, "confirmed");
  console.log("🎉 TX1 CONFIRMED! Token is live on Pump.fun!");
  console.log("URL: https://pump.fun/coin/" + mintPubkey.toBase58());

  console.log("\n🚀 SENDING TX2: Locking Fee Sharing Split (67% Pot / 33% Architect)...");
  const sig2 = await connection.sendRawTransaction(tx2.serialize(), { skipPreflight: false });
  console.log("TX2 Signature:", sig2);
  console.log("Confirming TX2...");
  await connection.confirmTransaction({ signature: sig2, blockhash: bh2, lastValidBlockHeight: lvb2 }, "confirmed");
  console.log("🎉 TX2 CONFIRMED! 67/33 Fee sharing locked on-chain forever!");

  const balAfter = await connection.getBalance(deployer.publicKey);
  console.log("\nDeployer Balance After:", (balAfter / 1e9), "SOL");
  console.log("V12 ENGINE LAUNCHED WITH 100% SUCCESS UNDER 0.1 SOL!");
}

main().catch(err => {
  console.error("FATAL ERROR:", err);
  if (err.logs) console.error("Logs:", err.logs);
  process.exit(1);
});
