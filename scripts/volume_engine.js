const {
  Connection,
  PublicKey,
  Keypair,
  Transaction,
  sendAndConfirmTransaction,
  SystemProgram,
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
console.log("🏎️ V12 OVERDRIVE MARKET MAKER ENGINE 🏎️");
console.log("=========================================");
console.log("Deployer:", deployer.publicKey.toBase58());
console.log("Target Mint ($V12):", mint.toBase58());

// Sub-wallets for diverse trader simulation
let traderA, traderB;
const subWalletsPath = "D:/Svemir/!Projekti/v12/keys/traders.json";
if (fs.existsSync(subWalletsPath)) {
  const data = JSON.parse(fs.readFileSync(subWalletsPath, "utf8"));
  traderA = Keypair.fromSecretKey(Uint8Array.from(data.a));
  traderB = Keypair.fromSecretKey(Uint8Array.from(data.b));
} else {
  traderA = Keypair.generate();
  traderB = Keypair.generate();
  fs.writeFileSync(subWalletsPath, JSON.stringify({
    a: Array.from(traderA.secretKey),
    b: Array.from(traderB.secretKey),
  }, null, 2));
}

console.log("Trader A:", traderA.publicKey.toBase58());
console.log("Trader B:", traderB.publicKey.toBase58());

async function fundTradersIfNeeded() {
  const balA = await connection.getBalance(traderA.publicKey);
  const balB = await connection.getBalance(traderB.publicKey);
  const depBal = await connection.getBalance(deployer.publicKey);

  console.log(`[Balances] Deployer: ${(depBal / 1e9).toFixed(4)} SOL | Trader A: ${(balA / 1e9).toFixed(4)} SOL | Trader B: ${(balB / 1e9).toFixed(4)} SOL`);

  const tx = new Transaction();
  if (balA < 30_000_000 && depBal > 70_000_000) {
    tx.add(SystemProgram.transfer({
      fromPubkey: deployer.publicKey,
      toPubkey: traderA.publicKey,
      lamports: 50_000_000, // 0.05 SOL
    }));
  }
  if (balB < 30_000_000 && depBal > 70_000_000) {
    tx.add(SystemProgram.transfer({
      fromPubkey: deployer.publicKey,
      toPubkey: traderB.publicKey,
      lamports: 50_000_000, // 0.05 SOL
    }));
  }

  if (tx.instructions.length > 0) {
    tx.feePayer = deployer.publicKey;
    const sig = await sendAndConfirmTransaction(connection, tx, [deployer]);
    console.log("⛽ Sub-traders funded with fuel! Sig:", sig);
  }
}

async function executeBuy(trader, solAmountNum) {
  const global = await onlineSdk.fetchGlobal();
  const curve = await onlineSdk.fetchBondingCurve(mint);

  const dx = new BN(Math.floor(solAmountNum * 1e9));
  const x = curve.virtualQuoteReserves;
  const y = curve.virtualTokenReserves;
  const tokenAmount = dx.mul(y).div(x.add(dx));

  console.log(`[BUY] ${trader.publicKey.toBase58().slice(0, 4)}.. buying with ${solAmountNum.toFixed(4)} SOL -> ~${(Number(tokenAmount) / 1e6).toFixed(0)} V12`);

  const ixs = await sdk.buyV2Instructions({
    global,
    bondingCurveAccountInfo: curve,
    bondingCurve: curve,
    mint,
    user: trader.publicKey,
    amount: tokenAmount.mul(new BN(85)).div(new BN(100)), // 15% slippage
    quoteAmount: dx,
    slippage: 15,
  });

  const tx = new Transaction().add(...ixs);
  tx.feePayer = trader.publicKey;
  const sig = await sendAndConfirmTransaction(connection, tx, [trader], { skipPreflight: true });
  console.log(`✅ [BUY SUCCESS] Sig: ${sig}`);
  return tokenAmount;
}

async function executeSell(trader, tokenAmount) {
  const global = await onlineSdk.fetchGlobal();
  const curve = await onlineSdk.fetchBondingCurve(mint);

  const dy = tokenAmount;
  const x = curve.virtualQuoteReserves;
  const y = curve.virtualTokenReserves;
  const expectedSol = dy.mul(x).div(y.add(dy));

  console.log(`[SELL] ${trader.publicKey.toBase58().slice(0, 4)}.. recycling ${(Number(tokenAmount) / 1e6).toFixed(0)} V12 -> ~${(Number(expectedSol) / 1e9).toFixed(4)} SOL`);

  const ixs = await sdk.sellV2Instructions({
    global,
    bondingCurveAccountInfo: curve,
    bondingCurve: curve,
    mint,
    user: trader.publicKey,
    amount: tokenAmount,
    quoteAmount: expectedSol.mul(new BN(85)).div(new BN(100)), // 15% slippage
    slippage: 15,
  });

  const tx = new Transaction().add(...ixs);
  tx.feePayer = trader.publicKey;
  const sig = await sendAndConfirmTransaction(connection, tx, [trader], { skipPreflight: true });
  console.log(`✅ [SELL SUCCESS] Recycled! Sig: ${sig}`);
}

async function loop() {
  try {
    await fundTradersIfNeeded();

    // Select trader A or B randomly
    const trader = Math.random() > 0.5 ? traderA : traderB;
    const bal = await connection.getBalance(trader.publicKey);

    if (bal > 20_000_000) {
      // Buy with random 0.012 to 0.025 SOL
      const buySol = 0.012 + Math.random() * 0.013;
      const boughtTokens = await executeBuy(trader, buySol);

      // Random hold time (10s to 30s)
      const holdTime = 10000 + Math.floor(Math.random() * 20000);
      console.log(`⏳ Holding for ${(holdTime / 1000).toFixed(0)}s to show green candle on chart...`);
      await new Promise(r => setTimeout(r, holdTime));

      // Sell back 60% - 85% of tokens to recycle SOL into the trader wallet
      const sellFraction = 0.60 + Math.random() * 0.25;
      const tokensToSell = boughtTokens.mul(new BN(Math.floor(sellFraction * 100))).div(new BN(100));
      await executeSell(trader, tokensToSell);
    }
  } catch (err) {
    console.error("Volume loop note:", err.message);
  }

  // Next cycle after 15-40 seconds
  const nextDelay = 15000 + Math.floor(Math.random() * 25000);
  console.log(`💤 Next volume pulse in ${(nextDelay / 1000).toFixed(0)}s...`);
  setTimeout(loop, nextDelay);
}

// Start market maker loop
loop();
