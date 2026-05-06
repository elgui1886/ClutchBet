import { Api } from "telegram";
import { createTelegramClient, resolvePeer } from "./telegram-utils.js";
import { getUnratedPostsWithMsgId, updateContentRating } from "./content-store.js";

/**
 * Checks Telegram reactions on published posts and updates their ratings in the DB.
 * 
 * Reaction mapping:
 * - 👍 (like, thumbs up, ❤️, 🔥, 👏) → rating = 1 (good)
 * - 👎 (dislike, thumbs down, 💩, 🤮) → rating = -1 (bad)
 * - No reaction or other → rating stays null
 * 
 * Only reads reactions from the channel owner (the user's own account).
 */
export async function checkReactionsForProfile(
  profile: string,
  publishChannel: string,
): Promise<{ checked: number; rated: number }> {
  const unrated = getUnratedPostsWithMsgId(profile);
  if (unrated.length === 0) {
    return { checked: 0, rated: 0 };
  }

  const client = await createTelegramClient();
  const peer = resolvePeer(publishChannel);
  let rated = 0;

  try {
    // Get the current user's ID (for filtering own reactions)
    const me = await client.getMe() as Api.User;
    const myId = me.id.toString();

    for (const post of unrated) {
      try {
        // Fetch the message to get its reactions
        const messages = await client.getMessages(peer, { ids: [post.telegramMsgId] });
        if (!messages || messages.length === 0) continue;

        const msg = messages[0];
        if (!msg || !msg.reactions) continue;

        // Check recent reactions on this message
        const reactions = msg.reactions;
        const rating = extractRatingFromReactions(reactions, myId);

        if (rating !== null) {
          updateContentRating(post.id, rating);
          rated++;
          const emoji = rating === 1 ? "👍" : "👎";
          console.log(`  ${emoji} Rated post ${post.id} (msg ${post.telegramMsgId}) = ${rating}`);
        }
      } catch (err) {
        // Skip individual message errors (e.g. message deleted)
        continue;
      }
    }
  } finally {
    await client.disconnect();
  }

  return { checked: unrated.length, rated };
}

/** Positive reaction emoticons */
const POSITIVE_REACTIONS = new Set(["👍", "❤️", "🔥", "👏", "⚡", "🏆", "💯", "❤"]);
/** Negative reaction emoticons */
const NEGATIVE_REACTIONS = new Set(["👎", "💩", "🤮", "😢", "🤡"]);

/**
 * Extracts a rating from message reactions.
 * Looks for the channel owner's reaction specifically, but falls back
 * to overall reaction sentiment if individual reactions aren't available.
 */
function extractRatingFromReactions(
  reactions: Api.MessageReactions,
  _myId: string,
): number | null {
  if (!reactions.results || reactions.results.length === 0) return null;

  // GramJS returns reaction results as counts. For channel posts,
  // we typically can't see WHO reacted (privacy), so we use a heuristic:
  // If there are recent reactions from the "recent reactors" list, check those.
  // Otherwise, check if the message has the "chosen" flag (meaning WE reacted).

  for (const result of reactions.results) {
    // The "chosenOrder" field is set when the current user (channel owner) reacted with this
    if ((result as any).chosenOrder != null) {
      const emoji = getReactionEmoji(result.reaction);
      if (emoji && POSITIVE_REACTIONS.has(emoji)) return 1;
      if (emoji && NEGATIVE_REACTIONS.has(emoji)) return -1;
    }
  }

  return null;
}

function getReactionEmoji(reaction: Api.TypeReaction): string | null {
  if (reaction instanceof Api.ReactionEmoji) {
    return reaction.emoticon;
  }
  return null;
}
