type ActivityCopySource = {
  title: string;
  description: string;
  source?: string | null;
};

function looksSynthetic(event: ActivityCopySource) {
  const combined = `${event.title} ${event.description} ${event.source ?? ""}`.toLowerCase();
  return combined.includes("playwright") || combined.includes("operator console") || combined.includes("retroactive work logging");
}

export function getReadableActivityTitle(event: ActivityCopySource) {
  if (looksSynthetic(event)) {
    return "Work log added";
  }
  return event.title;
}

export function getReadableActivityDescription(event: ActivityCopySource) {
  if (looksSynthetic(event)) {
    return "This entry was added later so the work history stays complete and accurate.";
  }
  return event.description;
}
