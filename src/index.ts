/**
 * CLI Dispatcher — routes to the correct workflow based on the first argument.
 *
 * Usage:
 *   npm start -- generation       Run the post-generation workflow
 *   npm start -- analysis         Run the channel-analysis workflow
 *   npm start -- content          Run the content-generator workflow
 *   npm start -- tips-extractor   Extract tips from channel into SQLite DB
 *   npm start -- check-results    Check results for pending bets + generate recap
 *   npm start -- watch-results    Watch for match results and publish recaps
 *   npm start -- parse-profile    Parse an MD profile to YAML
 */

const workflow = process.argv[2];

async function run() {
  switch (workflow) {
    case "generation": {
      const { main } = await import("./generation/index.js");
      await main();
      break;
    }
    case "analysis": {
      const { main } = await import("./analysis/index.js");
      await main();
      break;
    }
    case "content": {
      const { main } = await import("./content-generator/index.js");
      await main();
      break;
    }
    case "check-results": {
      await import("./check-results.js");
      break;
    }
    case "watch-results": {
      await import("./watch-results.js");
      break;
    }
    case "parse-profile": {
      await import("./parse-profile.js");
      break;
    }
    case "tips-extractor": {
      const { main } = await import("./tips-extractor/index.js");
      await main();
      break;
    }
    default:
      console.error(
        `❌ Unknown workflow: "${workflow ?? ""}"\n\n` +
          "Usage:\n" +
          "  npm start -- generation       Run the post-generation workflow\n" +
          "  npm start -- analysis         Run the channel-analysis workflow\n" +
          "  npm start -- content          Run the content-generator workflow\n" +
          "  npm start -- tips-extractor   Extract tips from channel into SQLite DB\n" +
          "  npm start -- check-results    Check results for pending bets\n" +
          "  npm start -- watch-results    Watch for match results\n" +
          "  npm start -- parse-profile    Parse an MD profile to YAML\n"
      );
      process.exit(1);
  }
}

run().catch((err) => {
  console.error(`❌ Workflow "${workflow}" failed:`, err);
  process.exit(1);
});
