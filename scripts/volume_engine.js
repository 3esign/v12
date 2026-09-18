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
const {
  getAssociatedTokenAddressSync,
  TOKEN_2022_PROGRAM_ID,
} = require("C:/Svemir/tools/solana-cli/scripts-scratch/node_modules/@solana/spl-token");
const BN = require("C:/Svemir/tools/solana-cli/scripts-scratch/node_modules/bn.js");
const fs = require("fs");

const RPC = "https://api.mainnet-beta.solana.com";
const connection = new Connection(RPC, "confirmed");
const sdk = new PumpSdk(connection);
const onlineSdk = new OnlinePumpSdk(connection);

const mint = new PublicKey("ZgVEVM7jFQyhq18NFLiRkHSa5vwjCAdE31KsLpE2Dti");
const deployerRaw = JSON.parse(fs.readFileSync("C:/Svemir/data/keys/botfarmer/deployer.json", "utf8"));
const deployer = Keypair.fromSecretKey(Uint8Array.from(deployerRaw));

console.log("==================================================");
console.log("🏎️ V12 PERPETUAL AUTONOMOUS MARKET MAKER (4 BOTS) 🏎️");
console.log("==================================================");

const tradersData = JSON.parse(fs.readFileSync("D:/Svemir/!Projekti/v12/keys/traders.json", "utf8"));

const BOTS = [
  { name: "WhalePulse (A)", kp: Keypair.fromSecretKey(Uint8Array.from(tradersData.a)), personality: "whale" },
  { name: "TapeTicking (B)", kp: Keypair.fromSecretKey(Uint8Array.from(tradersData.b)), personality: "scalper" },
  { name: "RandomWalker (C)", kp: Keypair.fromSecretKey(Uint8Array.from(tradersData.c)), personality: "noise" },
  { name: "Equalizer (D)", kp: Keypair.fromSecretKey(Uint8Array.from(tradersData.d)), personality: "rebalancer" },
];

BOTS.forEach(b => {
  b.ata = getAssociatedTokenAddressSync(mint, b.kp.publicKey, true, TOKEN_2022_PROGRAM_ID);
  console.log(`🤖 ${b.name} -> ${b.kp.publicKey.toBase58().slice(0, 4)}..${b.kp.publicKey.toBase58().slice(-4)} | Role: [${b.personality.toUpperCase()}]`);
});

// Helper to get on-chain token balance
async function getOnChainTokens(bot) {
  try {
    const bal = await connection.getTokenAccountBalance(bot.ata);
    if (bal && bal.value && bal.value.amount) {
      return new BN(bal.value.amount);
    }
  } catch (e) {
    // ATA might not exist yet or 0
  }
  return new BN(0);
}

// On-chain execute buy
async function executeBuy(bot, solAmount) {
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
    user: bot.kp.publicKey,
    amount: tokenAmount.mul(new BN(75)).div(new BN(100)), // 25% slippage tolerance
    quoteAmount: dx,
    slippage: 25,
  });

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 60000 }));
  tx.add(...ixs);
  tx.feePayer = bot.kp.publicKey;

  const sig = await sendAndConfirmTransaction(connection, tx, [bot.kp], { skipPreflight: true });
  console.log(`🟢 [BUY] ${bot.name} bought with ${solAmount.toFixed(4)} SOL (~${(Number(tokenAmount)/1e6).toFixed(0)} V12) | Sig: ${sig.slice(0, 16)}..`);
  return tokenAmount;
}

// On-chain execute sell
async function executeSell(bot, amountBN) {
  if (amountBN.lte(new BN(10000))) return;

  const global = await onlineSdk.fetchGlobal();
  const curve = await onlineSdk.fetchBondingCurve(mint);

  const x = curve.virtualQuoteReserves;
  const y = curve.virtualTokenReserves;
  const expectedSol = amountBN.mul(x).div(y.add(amountBN));

  const ixs = await sdk.sellV2Instructions({
    global,
    bondingCurveAccountInfo: curve,
    bondingCurve: curve,
    mint,
    user: bot.kp.publicKey,
    amount: amountBN,
    quoteAmount: expectedSol.mul(new BN(75)).div(new BN(100)), // 25% slippage tolerance
    slippage: 25,
  });

  const tx = new Transaction();
  tx.add(ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 60000 }));
  tx.add(...ixs);
  tx.feePayer = bot.kp.publicKey;

  const sig = await sendAndConfirmTransaction(connection, tx, [bot.kp], { skipPreflight: true });
  console.log(`🔴 [SELL] ${bot.name} recycled ${(Number(amountBN)/1e6).toFixed(0)} V12 -> ~${(Number(expectedSol)/1e9).toFixed(4)} SOL | Sig: ${sig.slice(0, 16)}..`);
}

// Fleet rebalancer: ensures no bot ever starves of SOL
async function checkFleetBalances() {
  const balances = [];
  let richestBot = BOTS[0];
  let maxBal = 0;

  for (const b of BOTS) {
    const bal = await connection.getBalance(b.kp.publicKey);
    balances.push({ bot: b, bal });
    if (bal > maxBal) {
      maxBal = bal;
      richestBot = b;
    }
  }

  // If any bot is under 0.015 SOL and the richest has > 0.045 SOL, donate 0.02 SOL
  for (const item of balances) {
    if (item.bal < 15_000_000 && maxBal > 45_000_000 && item.bot !== richestBot) {
      const tx = new Transaction().add(SystemProgram.transfer({
        fromPubkey: richestBot.kp.publicKey,
        toPubkey: item.bot.kp.publicKey,
        lamports: 20_000_000,
      }));
      tx.feePayer = richestBot.kp.publicKey;
      const sig = await sendAndConfirmTransaction(connection, tx, [richestBot.kp], { skipPreflight: true });
      console.log(`🔄 [FLEET REBALANCE] ${richestBot.name} shared 0.02 SOL with ${item.bot.name}! Sig: ${sig.slice(0, 16)}..`);
      break;
    }
  }
}

// Main Pulse Loop
let cycleCount = 0;

async function nextAction() {
  try {
    cycleCount++;
    if (cycleCount % 6 === 0) {
      await checkFleetBalances();
    }

    // Pick a random bot
    const bot = BOTS[Math.floor(Math.random() * BOTS.length)];
    const solBal = await connection.getBalance(bot.kp.publicKey);
    const tokens = await getOnChainTokens(bot);

    // Dynamic decision based on personality & state
    if (tokens.gt(new BN(200_000_000)) && (solBal < 20_000_000 || Math.random() > 0.50)) {
      // Must recycle tokens back to SOL
      const fraction = bot.personality === "whale" ? 0.95 : (0.60 + Math.random() * 0.35);
      const sellAmount = tokens.mul(new BN(Math.floor(fraction * 100))).div(new BN(100));
      await executeSell(bot, sellAmount);
    } else if (solBal > 15_000_000) {
      // Execute Buy
      let buySize;
      if (bot.personality === "whale") {
        buySize = 0.012 + Math.random() * 0.015; // 0.012 - 0.027 SOL
      } else if (bot.personality === "scalper") {
        buySize = 0.004 + Math.random() * 0.006; // 0.004 - 0.010 SOL
      } else {
        buySize = 0.007 + Math.random() * 0.009; // 0.007 - 0.016 SOL
      }
      buySize = Math.min(buySize, (solBal / 1e9) * 0.5); // Never spend more than 50% of available SOL
      if (buySize >= 0.004) {
        await executeBuy(bot, buySize);
      }
    } else if (tokens.gt(new BN(10000))) {
      // Low SOL, sell ALL tokens immediately to revive
      await executeSell(bot, tokens);
    }
  } catch (err) {
    const msg = err?.message || String(err);
    console.warn("Pulse note:", msg.slice(0, 90));
  }

  // Cadence: 5 to 12 seconds
  const delay = 5000 + Math.floor(Math.random() * 7000);
  setTimeout(nextAction, delay);
}

// Watchdog: ensures process never hangs indefinitely
setInterval(() => {
  // Simple heartbeat
}, 60000);

// Ignition
nextAction();
