import { renderBetSlipImage } from "./src/image-renderer.js";
import * as fs from "node:fs";

const testSlip = {
  title: "Schedina del Giorno",
  bets: [
    { homeTeam: "Juventus", awayTeam: "Inter", betType: "1X + Over 1.5", odd: 1.85 },
    { homeTeam: "Milan", awayTeam: "Roma", betType: "Goal", odd: 1.65 },
    { homeTeam: "Napoli", awayTeam: "Lazio", betType: "Over 2.5", odd: 1.90 },
    { homeTeam: "Atalanta", awayTeam: "Fiorentina", betType: "1", odd: 2.10 },
  ],
  totalOdd: 11.87,
};

(async () => {
  console.log("Rendering test image...");
  const buffer = await renderBetSlipImage(testSlip);
  fs.writeFileSync("test-output.png", buffer);
  console.log(`Done! Saved test-output.png (${Math.round(buffer.length / 1024)} KB)`);
})();
