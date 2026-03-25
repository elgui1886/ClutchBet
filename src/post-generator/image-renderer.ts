import { createCanvas } from "canvas";

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

// Colors
const BG_DARK = "#0a0e1a";
const BG_CARD = "#131a2e";
const ACCENT_GOLD = "#f0b90b";
const ACCENT_GREEN = "#00c853";
const TEXT_WHITE = "#ffffff";
const TEXT_GRAY = "#8892a4";
const BORDER_COLOR = "#1e2a45";

export function renderBetSlipImage(slip: BetSlip): Buffer {
  const WIDTH = 1080;
  const PADDING = 50;
  const ROW_HEIGHT = 110;
  const HEADER_HEIGHT = 160;
  const FOOTER_HEIGHT = 120;
  const HEIGHT = HEADER_HEIGHT + slip.bets.length * ROW_HEIGHT + FOOTER_HEIGHT + PADDING * 2;

  const canvas = createCanvas(WIDTH, HEIGHT);
  const ctx = canvas.getContext("2d");

  // Background
  ctx.fillStyle = BG_DARK;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  // Header
  ctx.fillStyle = ACCENT_GOLD;
  ctx.font = "bold 42px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(slip.title.toUpperCase(), WIDTH / 2, PADDING + 60);

  // Subtitle line
  ctx.fillStyle = TEXT_GRAY;
  ctx.font = "22px Arial, sans-serif";
  ctx.fillText(`${slip.bets.length} EVENTI • QUOTA ${slip.totalOdd.toFixed(2)}`, WIDTH / 2, PADDING + 100);

  // Divider after header
  const headerBottom = PADDING + HEADER_HEIGHT;
  ctx.strokeStyle = ACCENT_GOLD;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(PADDING, headerBottom - 20);
  ctx.lineTo(WIDTH - PADDING, headerBottom - 20);
  ctx.stroke();

  // Bet rows
  slip.bets.forEach((bet, i) => {
    const y = headerBottom + i * ROW_HEIGHT;

    // Row background (alternating)
    ctx.fillStyle = i % 2 === 0 ? BG_CARD : BG_DARK;
    roundRect(ctx, PADDING, y, WIDTH - PADDING * 2, ROW_HEIGHT - 10, 12);
    ctx.fill();

    // Row border
    ctx.strokeStyle = BORDER_COLOR;
    ctx.lineWidth = 1;
    roundRect(ctx, PADDING, y, WIDTH - PADDING * 2, ROW_HEIGHT - 10, 12);
    ctx.stroke();

    // Event number
    ctx.fillStyle = ACCENT_GOLD;
    ctx.font = "bold 20px Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`${i + 1}`, PADDING + 20, y + 40);

    // Teams
    ctx.fillStyle = TEXT_WHITE;
    ctx.font = "bold 26px Arial, sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`${bet.homeTeam}  vs  ${bet.awayTeam}`, PADDING + 55, y + 40);

    // Bet type
    ctx.fillStyle = TEXT_GRAY;
    ctx.font = "20px Arial, sans-serif";
    ctx.fillText(bet.betType, PADDING + 55, y + 72);

    // Odd (right side with green badge)
    const oddText = bet.odd.toFixed(2);
    const oddX = WIDTH - PADDING - 30;
    const oddWidth = 90;

    ctx.fillStyle = ACCENT_GREEN;
    roundRect(ctx, oddX - oddWidth, y + 20, oddWidth, 50, 8);
    ctx.fill();

    ctx.fillStyle = "#000000";
    ctx.font = "bold 24px Arial, sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(oddText, oddX - oddWidth / 2, y + 52);
  });

  // Footer
  const footerY = headerBottom + slip.bets.length * ROW_HEIGHT + 20;

  // Total odd section
  ctx.fillStyle = ACCENT_GOLD;
  ctx.font = "bold 22px Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText("QUOTA TOTALE", WIDTH / 2, footerY + 20);

  ctx.fillStyle = TEXT_WHITE;
  ctx.font = "bold 52px Arial, sans-serif";
  ctx.fillText(slip.totalOdd.toFixed(2), WIDTH / 2, footerY + 78);

  return canvas.toBuffer("image/png");
}

function roundRect(
  ctx: ReturnType<ReturnType<typeof createCanvas>["getContext"]>,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}
