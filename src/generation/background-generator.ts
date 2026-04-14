import OpenAI from "openai";
import type { BrandingConfig } from "../content-generator/state.js";

const openai = new OpenAI();

/**
 * Generates a unique background image using DALL-E / gpt-image-1,
 * themed to the profile's branding and the specific editorial format.
 *
 * Returns a base64-encoded PNG (1080×1920).
 */
export async function generateBackground(
  branding: BrandingConfig,
  formatName: string,
): Promise<string> {
  const prompt = buildBackgroundPrompt(branding, formatName);

  console.log(`  🎨 Generating AI background for "${formatName}"...`);

  const response = await openai.images.generate({
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
