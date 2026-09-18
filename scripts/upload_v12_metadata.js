const fs = require("fs");

async function main() {
  const imagePath = "D:\\Svemir\\!Projekti\\v12\\logo.jpg";
  const imageBuffer = fs.readFileSync(imagePath);

  const form = new FormData();
  form.append("file", new Blob([imageBuffer], { type: "image/jpeg" }), "logo.jpg");
  form.append("name", "V12 Overdrive");
  form.append("symbol", "V12");
  form.append("description", "V12 Overdrive is a high-octane autonomous economic engine on Pump.fun. 67% of all creator trading fees feed the on-chain V12 Pot, while 33% routes to the Architect. Each progressive round, the tachometer redlines: 50% of the pot executes a Buy & Burn on the bonding curve, while 50% drops directly as clean SOL to the Top 5 Diamond Wallets. Progressive tachometer builds momentum from 20s (+10% per round) up to a permanent 24h Daily Redline ceiling.");
  form.append("twitter", "https://x.com/SonyxEth/status/2101036196252332220?s=20");
  form.append("telegram", "https://t.me/ratchetx");
  form.append("website", "https://v12.ratchetx.xyz");
  form.append("showName", "true");

  console.log("Uploading V12 metadata to pump.fun/api/ipfs...");
  const response = await fetch("https://pump.fun/api/ipfs", {
    method: "POST",
    body: form,
  });

  console.log("Status:", response.status);
  const json = await response.json();
  console.log("Metadata URI:", json.metadataUri);
  fs.writeFileSync("D:\\Svemir\\!Projekti\\v12\\scripts\\metadata-uri.json", JSON.stringify(json, null, 2));
}

main().catch(err => {
  console.error("Upload Error:", err);
  process.exit(1);
});
