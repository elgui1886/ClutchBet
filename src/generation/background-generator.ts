import OpenAI from "openai";
import type { BrandingConfig } from "../content-generator/state.js";

/**
 * Separate OpenAI client for image generation via OpenAI's own API.
 * GitHub Models doesn't support DALL-E, so we use a dedicated OpenAI API key
 * pointed directly at api.openai.com.
 */
function getImageClient(): OpenAI {
  const apiKey = process.env.OPENAI_IMAGE_API_KEY;
  if (!apiKey) {
    throw new Error(
      "OPENAI_IMAGE_API_KEY not set. Add your OpenAI API key for image generation in .env",
    );
  }
  return new OpenAI({
    apiKey,
    baseURL: "https://api.openai.com/v1",
  });
}

/**
 * Generates a unique background image using DALL-E 3 via OpenAI's API,
 * themed to the profile's branding and the specific editorial format.
 *
 * Returns a base64-encoded PNG (1024×1792).
 */
export async function generateBackground(
  branding: BrandingConfig,
  formatName: string,
): Promise<string> {
  const client = getImageClient();
  const prompt = buildBackgroundPrompt(branding, formatName);

  console.log(`  🎨 Generating AI background for "${formatName}" (DALL-E 3)...`);

  const response = await client.images.generate({
    model: "dall-e-3",
    prompt,
    n: 1,
    size: "1024x1792",
    quality: "standard",
    response_format: "b64_json",
  });

  const imageData = response.data?.[0];
  if (!imageData?.b64_json) {
    throw new Error("No image data returned from OpenAI image generation");
  }

  console.log(`  🎨 Background generated successfully`);
  return imageData.b64_json;
}

function buildBackgroundPrompt(
  branding: BrandingConfig,
  formatName: string,
): string {
  return [
    `Create an abstract, atmospheric background image for a premium sports betting Telegram channel post titled "${formatName}".`,
    `Visual mood: ${branding.bg_prompt_hint}`,
    `Color palette: dominant ${branding.primary_color}, accent ${branding.accent_color}.`,
    `The image must be abstract and atmospheric — NO text, NO numbers, NO words, NO letters, NO logos.`,
    `The center and bottom areas should be darker/subdued to allow white text overlay to be readable.`,
    `Style: cinematic, slightly blurred bokeh effects, dramatic lighting, depth-of-field.`,
    `The image must feel premium and authoritative, like a high-end sports media brand.`,
  ].join(" ");
}
