/**
 * CLI Dispatcher — routes to the correct workflow based on the first argument.
 *
 * Usage:
 *   npm start -- generation    Run the post-generation workflow
 *   npm start -- analysis      Run the channel-analysis workflow
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
    default:
      console.error(
        `❌ Unknown workflow: "${workflow ?? ""}"\n\n` +
          "Usage:\n" +
          "  npm start -- generation   Run the post-generation workflow\n" +
          "  npm start -- analysis     Run the channel-analysis workflow\n"
      );
      process.exit(1);
  }
}

run().catch((err) => {
  console.error(`❌ Workflow "${workflow}" failed:`, err);
  process.exit(1);
});
