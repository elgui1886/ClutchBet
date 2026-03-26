import "dotenv/config";
import { CustomFile } from "telegram/client/uploads";
import { createTelegramClient, resolvePeer } from "../../shared/telegram-utils.js";
import type { WorkflowStateType } from "../state.js";

export async function publisherNode(
  state: WorkflowStateType
): Promise<Partial<WorkflowStateType>> {
  const { generatedPost, publishChannel } = state;

  if (!publishChannel) {
    console.log("⚠️  No publish channel configured. Skipping publish.");
    return { publishResult: "skipped: no publishChannel configured" };
  }

  if (!generatedPost) {
    console.log("⚠️  No generated post to publish.");
    return { publishResult: "skipped: no generatedPost" };
  }

  const client = await createTelegramClient();

  try {
    const peer = resolvePeer(publishChannel);
    console.log(`\n📤 Publishing to channel: ${publishChannel}`);

    const imageBuffer = Buffer.from(generatedPost.imageBase64, "base64");
    const fullText = generatedPost.text;
    const MAX_CAPTION = 1024;

    if (fullText.length <= MAX_CAPTION) {
      // Text fits in caption — single message with image + text
      await client.sendFile(peer, {
        file: new CustomFile("post.png", imageBuffer.length, "", imageBuffer),
        caption: fullText,
      });
    } else {
      // Text too long for caption — image first, then full text as separate message
      await client.sendFile(peer, {
        file: new CustomFile("post.png", imageBuffer.length, "", imageBuffer),
      });
      await client.sendMessage(peer, { message: fullText });
    }

    console.log("  ✅ Post published successfully!");
    return { publishResult: "published" };
  } catch (err) {
    console.error("  ❌ Failed to publish:", err);
    return { publishResult: `error: ${err}` };
  } finally {
    await client.disconnect();
  }
}
