const {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
  SystemProgram,
  ComputeBudgetProgram,
} = require("C:/Svemir/tools/solana-cli/scripts-scratch/node_modules/@solana/web3.js");
const {
  PumpSdk,
  OnlinePumpSdk,
} = require("C:/Svemir/tools/solana-cli/scripts-scratch/node_modules/@pump-fun/pump-sdk");
const BN = require("C:/Svemir/tools/solana-cli/scripts-scratch/node_modules/bn.js");
const fs = require("fs");

const RPC = "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC, "confirmed");
const sdk = new PumpSdk(connection);
const onlineSdk = new OnlinePumpSdk(connection);

const mint = new PublicKey("ZgVEVM7jFQyhq18NFLiRkHSa5vwjCAdE31KsLpE2Dti");
const deployerRaw = JSON.parse(fs.readFileSync("C:/Svemir/data/keys/botfarmer/deployer.json", "utf8"));
const deployer = Keypair.fromSecretKey(Uint8Array.from(deployerRaw));

console.log("=========================================");
console.log("⚡ V12 TURBO HIGH-FREQUENCY MARKET MAKER ⚡");
console.log("=========================================");

const tradersData = JSON.parse(fs.readFileSync("D:/Svemir/!Projekti/v12/keys/traders.json", "utf8"));
const traders = [
  { name: "A", kp: Keypair.fromSecretKey(Uint8Array.from(tradersData.a)), tokensHeld: new BN(0) },
  { name: "B", kp: Keypair.fromSecretKey(Uint8Array.from(tradersData.b)), tokensHeld: new BN(0) },
  { name: "C", kp: Keypair.fromSecretKey(Uint8Array.from(tradersData.c)), tokensHeld: new BN(0) },
  { name: "D", kp: Keypair.fromSecretKey(Uint8Array.from(tradersData.d)), tokensHeld: new BN(0) },
];

traders.forEach(t => console.log(`Trader ${t.name}: ${t.kp.publicKey.toBase58()}`));

async function fundTraders() {
  const depBal = await connection.getBalance(deployer.publicKey);
  const tx = new Transaction();
  
  for (const t of traders) {
    const bal = await connection.getBalance(t.kp.publicKey);
    if (bal < 15_000_000 && depBal > 40_000_000) {
      tx.add(SystemProgram.transfer({
        fromPubkey: deployer.publicKey,
        toPubkey: t.kp.publicKey,
        lamports: 35_000_000, // 0.035 SOL
      }));
    }
  }

  if (tx.instructions.length > 0) {
    tx.feePayer = deployer.publicKey;
    const sig = await sendAndConfirmTransaction(connection, tx, [deployer], { skipPreflight: true });
    console.log("⛽ Sub-traders topped up with fresh fuel! Sig:", sig.slice(0, 20) + "...");
  }
}

async function buy(traderObj, solAmount) {
  const global = await onlineSdk.fetchGlobal();
  const curve = await onlineSdk.fetchBondingCurve(mint);

  const dx = new BN(Math.floor(solAmount * 1e9));
  const x = curve.virtualQuoteReserves;
  const y = curve.virtualTokenReserves;
  const tokenAmount = dx.mul(y).div(x.add(dx));

  const ixs = await sdk.buyV2Instructions({
    global,
    bondingCurveAccountInfo: curve,
    bondingCurve: curve,
    mint,
    user: traderObj.kp.publicKey,
    amount: tokenAmount.mul(new BN(80)).div(new BN(100)),
    quoteAmount: dx,
    slippage: 20,
  });

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }));
  tx.add(...ixs);
  tx.feePayer = traderObj.kp.publicKey;

  const sig = await sendAndConfirmTransaction(connection, tx, [traderObj.kp], { skipPreflight: true });
  traderObj.tokensHeld = traderObj.tokensHeld.add(tokenAmount);
  console.log(`🟢 [BUY] Trader ${traderObj.name} bought with ${solAmount.toFixed(4)} SOL (~${(Number(tokenAmount)/1e6).toFixed(0)} V12) | Sig: ${sig.slice(0, 16)}..`);
}

async function sell(traderObj, fraction = 0.70) {
  if (traderObj.tokensHeld.lte(new BN(0))) return;

  const global = await onlineSdk.fetchGlobal();
  const curve = await onlineSdk.fetchBondingCurve(mint);

  const dy = traderObj.tokensHeld.mul(new BN(Math.floor(fraction * 100))).div(new BN(100));
  if (dy.lte(new BN(10000))) return;

  const x = curve.virtualQuoteReserves;
  const y = curve.virtualTokenReserves;
  const expectedSol = dy.mul(x).div(y.add(dy));

  const ixs = await sdk.sellV2Instructions({
    global,
    bondingCurveAccountInfo: curve,
    bondingCurve: curve,
    mint,
    user: traderObj.kp.publicKey,
    amount: dy,
    quoteAmount: expectedSol.mul(new BN(80)).div(new BN(100)),
    slippage: 20,
  });

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50000 }));
  tx.add(...ixs);
  tx.feePayer = traderObj.kp.publicKey;

  const sig = await sendAndConfirmTransaction(connection, tx, [traderObj.kp], { skipPreflight: true });
  traderObj.tokensHeld = traderObj.tokensHeld.sub(dy);
  console.log(`🔴 [SELL] Trader ${traderObj.name} recycled ${(Number(dy)/1e6).toFixed(0)} V12 -> ~${(Number(expectedSol)/1e9).toFixed(4)} SOL | Sig: ${sig.slice(0, 16)}..`);
}

let step = 0;
async function pulse() {
  try {
    if (step % 5 === 0) {
      await fundTraders();
    }

    // Pick random trader
    const t = traders[Math.floor(Math.random() * traders.length)];
    const bal = await connection.getBalance(t.kp.publicKey);

    // Decision: Buy or Sell?
    // If trader has tokens and good balance, 60% chance to buy, 40% chance to sell
    const shouldSell = t.tokensHeld.gt(new BN(100_000_000)) && (Math.random() > 0.55 || bal < 12_000_000);

    if (shouldSell) {
      await sell(t, 0.65 + Math.random() * 0.25);
    } else if (bal > 12_000_000) {
      // Rapid micro-buy: 0.006 to 0.016 SOL
      const buySize = 0.006 + Math.random() * 0.010;
      await buy(t, buySize);
    }

    step++;
  } catch (err) {
    const errMsg = err?.message || String(err);
    console.warn("Pulse note:", errMsg.slice(0, 80));
  }

  // ULTRA RAPID PULSE: 4 to 8 seconds delay!
  const delay = 4000 + Math.floor(Math.random() * 4500);
  setTimeout(pulse, delay);
}

// Start High-Frequency Pulse
pulse();
