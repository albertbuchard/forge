import { getGoalById } from "../repositories/goals.js";
import { listTags, listTagsByIds } from "../repositories/tags.js";
const keywordHints = {
    health: ["Health", "Vitality"],
    train: ["Health", "Vitality"],
    workout: ["Health", "Vitality"],
    review: ["Reflection", "Craft"],
    plan: ["Momentum", "Admin"],
    admin: ["Admin"],
    write: ["Craft", "Deep Work"],
    draft: ["Craft", "Deep Work"],
    relationship: ["Relationships"],
    date: ["Relationships"],
    focus: ["Deep Work"]
};
function uniqueTags(tags) {
    const seen = new Set();
    return tags.filter((tag) => {
        if (seen.has(tag.id)) {
            return false;
        }
        seen.add(tag.id);
        return true;
    });
}
export function suggestTags(input) {
    const tagCatalog = listTags();
    const selected = new Set(input.selectedTagIds);
    const terms = `${input.title} ${input.description}`.toLowerCase();
    const suggestions = [];
    for (const [keyword, tagNames] of Object.entries(keywordHints)) {
        if (!terms.includes(keyword)) {
            continue;
        }
        for (const tagName of tagNames) {
            const tag = tagCatalog.find((entry) => entry.name === tagName);
            if (tag && !selected.has(tag.id)) {
                suggestions.push(tag);
            }
        }
    }
    if (input.goalId) {
        const goal = getGoalById(input.goalId);
        if (goal) {
            suggestions.push(...listTagsByIds(goal.tagIds).filter((tag) => !selected.has(tag.id)));
        }
    }
    return uniqueTags(suggestions).slice(0, 6);
}
