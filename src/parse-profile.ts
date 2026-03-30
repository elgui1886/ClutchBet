import "dotenv/config";
import * as fs from "node:fs";
import * as path from "node:path";
import { HumanMessage } from "@langchain/core/messages";
import { ChatOpenAI } from "@langchain/openai";
import { loadPrompt } from "./shared/llm-utils.js";

const PARSER_PROMPT_PATH = path.resolve("prompts", "profile-parser.md");
const PROFILES_DIR = path.resolve("config", "profiles");

async function main() {
  const mdPath = process.argv[2];

  if (!mdPath) {
    console.error(
      "❌ Usage: npm run parse-profile -- <path-to-md>\n\n" +
        "Example:\n" +
        "  npm run parse-profile -- output/profiles/il-capitano.md\n"
    );
    process.exit(1);
  }

  const resolvedPath = path.resolve(mdPath);
  if (!fs.existsSync(resolvedPath)) {
    console.error(`❌ File not found: ${resolvedPath}`);
    process.exit(1);
  }

  console.log(`📄 Reading profile: ${resolvedPath}`);
  const profileContent = fs.readFileSync(resolvedPath, "utf-8");

  const template = loadPrompt(PARSER_PROMPT_PATH);
  const prompt = template.replace("{profile_content}", profileContent);

  const model = new ChatOpenAI({
    modelName: process.env.OPENAI_MODEL ?? "gpt-4o",
    temperature: 0,
  });

  console.log("🧠 Parsing profile with LLM...");
  const response = await model.invoke([new HumanMessage(prompt)]);
  const raw =
    typeof response.content === "string"
      ? response.content
      : JSON.stringify(response.content);

  // Strip markdown code fences if present
  const cleaned = raw
    .replace(/^```ya?ml\s*/i, "")
    .replace(/```\s*$/i, "")
    .trim();

  // Validate it's parseable YAML
  const { parse: parseYaml } = await import("yaml");
  try {
    parseYaml(cleaned);
  } catch (err) {
    console.error("❌ LLM returned invalid YAML:", err);
    console.error("\n--- Raw output ---\n" + cleaned);
    process.exit(1);
  }

  // Derive output filename from MD filename
  const baseName = path.basename(resolvedPath, ".md");
  if (!fs.existsSync(PROFILES_DIR)) {
    fs.mkdirSync(PROFILES_DIR, { recursive: true });
  }
  const outputPath = path.join(PROFILES_DIR, `${baseName}.yaml`);

  fs.writeFileSync(outputPath, cleaned, "utf-8");
  console.log(`✅ Profile saved to: ${outputPath}`);
}

main().catch((err) => {
  console.error("❌ parse-profile failed:", err);
  process.exit(1);
});
