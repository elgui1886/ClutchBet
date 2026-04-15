import puppeteer from "puppeteer";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import type { BrandingConfig } from "../content-generator/state.js";

export interface BetSlip {
  title: string;
  bets: Array<{
    homeTeam: string;
    awayTeam: string;
    betType: string;
    odd: number;
    result?: "won" | "lost";
    matchScore?: string;
  }>;
  totalOdd: number;
}

/** Data passed to the HTML template's render() function */
interface SlipRenderData {
  title: string;
  bets: BetSlip["bets"];
  totalOdd: number;
  branding: BrandingConfig;
  profileName: string;
  backgroundBase64?: string;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const TEMPLATE_V2_PATH = path.resolve(__dirname, "templates", "bet-slip-v2.html");
const TEMPLATE_LEGACY_PATH = path.resolve(__dirname, "templates", "bet-slip.html");

/**
 * Renders a branded bet-slip image with an AI-generated background.
 * Falls back to a plain dark background if no backgroundBase64 is provided.
 */
export async function renderBetSlipImage(
  slip: BetSlip,
  branding?: BrandingConfig,
  profileName?: string,
  backgroundBase64?: string,
): Promise<Buffer> {
  // Use the new branded template when branding is available, legacy otherwise
  const templatePath = branding ? TEMPLATE_V2_PATH : TEMPLATE_LEGACY_PATH;
  const html = fs.readFileSync(templatePath, "utf-8");

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1080, height: 1920 });
    await page.setContent(html, { waitUntil: "networkidle0" });

    if (branding) {
      // New branded template
      const renderData: SlipRenderData = {
        title: slip.title,
        bets: slip.bets,
        totalOdd: slip.totalOdd,
        branding,
        profileName: profileName ?? "ClutchBet",
        backgroundBase64,
      };
      await page.evaluate((data: SlipRenderData) => {
        (window as any).render(data);
      }, renderData);
    } else {
      // Legacy template (backwards compatible)
      await page.evaluate((data: BetSlip) => {
        (window as any).render(data);
      }, slip);
    }

    // Wait for background image to load + CSS transitions
    await new Promise((r) => setTimeout(r, 500));

    const element = await page.$("#slip");
    if (!element) throw new Error("Could not find #slip element in template");

    const screenshot = await element.screenshot({ type: "png" });
    return Buffer.from(screenshot);
  } finally {
    await browser.close();
  }
}
