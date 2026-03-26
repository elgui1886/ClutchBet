import puppeteer from "puppeteer";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

export interface BetSlip {
  title: string;
  bets: Array<{
    homeTeam: string;
    awayTeam: string;
    betType: string;
    odd: number;
  }>;
  totalOdd: number;
}

const TEMPLATE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "templates",
  "bet-slip.html"
);

export async function renderBetSlipImage(slip: BetSlip): Promise<Buffer> {
  const html = fs.readFileSync(TEMPLATE_PATH, "utf-8");

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1920 });
    await page.setContent(html, { waitUntil: "networkidle0" });

    // Inject bet data and render
    await page.evaluate((data: BetSlip) => {
      (window as any).render(data);
    }, slip);

    // Wait a moment for any CSS transitions
    await new Promise((r) => setTimeout(r, 200));

    // Screenshot only the slip container
    const element = await page.$("#slip");
    if (!element) throw new Error("Could not find #slip element in template");

    const screenshot = await element.screenshot({ type: "png" });
    return Buffer.from(screenshot);
  } finally {
    await browser.close();
  }
}
