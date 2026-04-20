import * as fs from "node:fs";
import { SystemMessage } from "@langchain/core/messages";
import type { ProfileConfig } from "../content-generator/state.js";

/**
 * Load a prompt template from a file path.
 */
export function loadPrompt(filePath: string): string {
  return fs.readFileSync(filePath, "utf-8");
}

/**
 * Builds the two system messages to inject into every LLM call:
 *
 * 1. Global expert identity — who the AI is as a domain expert.
 * 2. Profile persona — the specific character/tone being portrayed.
 */
export function buildSystemMessages(profile: ProfileConfig): [SystemMessage, SystemMessage] {
  const globalPrompt = [
    "Sei un esperto analista di scommesse sportive e creator di contenuti per canali Telegram premium.",
    "Conosci a fondo i mercati delle scommesse (1X2, Over/Under, BTTS, handicap, marcatori, cartellini),",
    "le dinamiche del calcio e del tennis professionistico, e sai come costruire un'audience fidelizzata nel settore del betting.",
    "I tuoi contenuti sono sempre in italiano, concisi, diretti e coinvolgenti.",
    "Non fai mai affermazioni fuorvianti su certezze di vincita, ma esprimi fiducia e convinzione quando la senti.",
    "Rispondi SEMPRE e SOLO in italiano, qualunque cosa ti venga chiesto.",
  ].join(" ");

  const { profile: p, tone } = profile;

  const universeLines = p.universe
    .map((u) => `  • ${u.name}: ${u.role}`)
    .join("\n");

  const tonePrinciples = tone.principles
    .map((t) => `  - ${t}`)
    .join("\n");

  const forbiddenPhrases = tone.forbidden_phrases
    .map((f) => `  ✗ "${f}"`)
    .join("\n");

  const examplePhrases = tone.example_phrases
    .map((e) => `  • "${e}"`)
    .join("\n");

  const profilePrompt = [
    `Stai interpretando il personaggio di ${p.name} (${p.handle}).`,
    `Claim: "${p.claim}"`,
    ``,
    `Universo del canale:`,
    universeLines,
    ``,
    `PRINCIPI DI TONO:`,
    tonePrinciples,
    ``,
    `FRASI VIETATE (non usare mai):`,
    forbiddenPhrases,
    ``,
    `FRASI TIPO (ispirati a questo stile):`,
    examplePhrases,
    ``,
    `REGISTRO: ${tone.register}`,
    `EMOJI: massimo ${tone.emoji_max} per post.`,
    `MAIUSCOLO: ${tone.uppercase_rule}`,
  ].join("\n");

  return [new SystemMessage(globalPrompt), new SystemMessage(profilePrompt)];
}
