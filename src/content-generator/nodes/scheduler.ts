import type { ContentStateType, ProfileConfig } from "../state.js";

/**
 * Scheduler node — decides which editorial formats to generate today
 * based on the profile's scheduling rules and whether there are match-day fixtures.
 */
export async function schedulerNode(
  state: ContentStateType
): Promise<Partial<ContentStateType>> {
  const { profile, date } = state;

  if (!profile) {
    console.log("❌ No profile loaded. Cannot schedule.");
    return { scheduledFormats: [] };
  }

  const today = new Date(date);
  const dayOfWeek = today.getDay(); // 0=Sun, 5=Fri, 6=Sat
  const dayName = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"][dayOfWeek];

  console.log(`📅 Scheduling for ${date} (${dayName})\n`);

  const selected: string[] = [];
  const { scheduling, formats } = profile;
  const formatSlugs = new Set(formats.map((f) => f.slug));

  // Check special triggers first
  for (const special of scheduling.special) {
    if (shouldTrigger(special.trigger, dayOfWeek, date)) {
      for (const slug of special.formats) {
        if (formatSlugs.has(slug) && !selected.includes(slug)) {
          selected.push(slug);
        }
      }
    }
  }

  // We don't know yet if it's a match day (no fixtures fetched at this stage).
  // Assume match day for now — the data-fetcher will clarify.
  // Schedule match_day formats by default; if no fixtures are found,
  // the content-writer will fall back to no_match_day formats.
  const matchDayFormats = scheduling.match_day.formats;
  const noMatchFormats = scheduling.no_match_day.formats;

  // Add all match_day formats (will be filtered later if no fixtures)
  for (const slug of matchDayFormats) {
    if (formatSlugs.has(slug) && !selected.includes(slug)) {
      selected.push(slug);
    }
  }

  // Also add no_match_day formats (always useful as fallback)
  for (const slug of noMatchFormats) {
    if (formatSlugs.has(slug) && !selected.includes(slug)) {
      selected.push(slug);
    }
  }

  console.log(`📋 Scheduled formats: ${selected.length > 0 ? selected.join(", ") : "(none)"}`);

  return { scheduledFormats: selected };
}

/**
 * Determines if a special trigger should fire for the given day.
 */
function shouldTrigger(trigger: string, dayOfWeek: number, dateStr: string): boolean {
  switch (trigger) {
    case "sunday_evening":
      return dayOfWeek === 0; // Sunday
    case "friday_saturday":
      return dayOfWeek === 5 || dayOfWeek === 6; // Friday or Saturday
    case "monthly": {
      // Fire on the last day of the month (or first of next — simplified: day 1)
      const day = new Date(dateStr).getDate();
      return day === 1;
    }
    case "big_match":
    case "derby":
      // These are event-driven, not calendar-driven.
      // Will be triggered by data-fetcher when it detects derby/big-match fixtures.
      return false;
    default:
      return false;
  }
}
