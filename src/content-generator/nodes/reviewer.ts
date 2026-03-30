import * as readline from "node:readline";
import type { ContentStateType, ContentItem } from "../state.js";

/**
 * Reviewer node — human-in-the-loop review of generated content.
 * Shows each generated post and asks for approval before publishing.
 */
export async function reviewerNode(
  state: ContentStateType
): Promise<Partial<ContentStateType>> {
  const { contentItems } = state;

  if (contentItems.length === 0) {
    console.log("ℹ️  No content to review.");
    return { contentItems: [] };
  }

  console.log("\n" + "=".repeat(60));
  console.log("📝 REVIEW — Approva i post prima della pubblicazione");
  console.log("=".repeat(60) + "\n");

  const reviewed: ContentItem[] = [];

  for (let i = 0; i < contentItems.length; i++) {
    const item = contentItems[i];

    console.log(`--- [${i + 1}/${contentItems.length}] ${item.formatName} ---\n`);
    console.log(item.text);
    console.log("\n" + "-".repeat(40));

    const answer = await askUser(
      `Approvare "${item.formatName}"? (s = sì, n = no, e = edit manuale poi sì): `
    );

    if (answer.toLowerCase() === "s" || answer.toLowerCase() === "si") {
      reviewed.push({ ...item, approved: true });
      console.log("✅ Approvato\n");
    } else if (answer.toLowerCase() === "e" || answer.toLowerCase() === "edit") {
      console.log(
        "\n📋 Il testo è stato stampato sopra. Modificalo esternamente, " +
          "poi incolla qui la versione corretta (termina con una riga vuota):\n"
      );
      const edited = await readMultiline();
      if (edited.trim()) {
        reviewed.push({ ...item, text: edited.trim(), approved: true });
        console.log("✅ Approvato (con modifiche)\n");
      } else {
        reviewed.push({ ...item, approved: true });
        console.log("✅ Approvato (testo originale, input vuoto)\n");
      }
    } else {
      reviewed.push({ ...item, approved: false });
      console.log("❌ Scartato\n");
    }
  }

  const approvedCount = reviewed.filter((r) => r.approved).length;
  console.log(
    `\n📊 Review completata: ${approvedCount}/${reviewed.length} approvati\n`
  );

  return { contentItems: reviewed };
}

function askUser(question: string): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

function readMultiline(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  return new Promise((resolve) => {
    const lines: string[] = [];
    rl.on("line", (line) => {
      if (line === "") {
        rl.close();
        resolve(lines.join("\n"));
      } else {
        lines.push(line);
      }
    });
    rl.on("close", () => {
      resolve(lines.join("\n"));
    });
  });
}
