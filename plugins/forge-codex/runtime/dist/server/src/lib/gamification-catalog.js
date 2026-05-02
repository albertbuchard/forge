const CATEGORY_CONFIGS = [
    { id: "xp_levels", label: "XP and level", trophyCount: 8, unlockCount: 4 },
    { id: "streaks", label: "Streak and comeback", trophyCount: 14, unlockCount: 10 },
    { id: "tasks", label: "Tasks and focus runs", trophyCount: 14, unlockCount: 4 },
    { id: "projects", label: "Projects, goals, and strategy", trophyCount: 14, unlockCount: 4 },
    { id: "wiki", label: "Wiki, notes, and knowledge graph", trophyCount: 16, unlockCount: 6 },
    { id: "psyche", label: "Psyche", trophyCount: 18, unlockCount: 10 },
    { id: "habits", label: "Habits, Life Force, and health", trophyCount: 8, unlockCount: 8 },
    { id: "agents", label: "Agents and collaboration", trophyCount: 4, unlockCount: 2 }
];
const MASCOT_SKINS = [
    { id: "obsidian-smith", title: "Obsidian Smith", palette: "black iron and ember gold" },
    { id: "scholar-smith", title: "Scholar Smith", palette: "violet scholar glass and brass" },
    { id: "storm-forger", title: "Storm Forger", palette: "cyan lightning and dark steel" },
    { id: "clockwork-smith", title: "Clockwork Smith", palette: "bronze gears and smoked glass" },
    { id: "celestial-smith", title: "Celestial Smith", palette: "star gold and deep blue steel" },
    { id: "shadow-smith", title: "Shadow Smith", palette: "charcoal, silver, and cold violet" },
    { id: "ember-knight", title: "Ember Knight", palette: "molten armor and red coals" },
    { id: "arcane-metallurgist", title: "Arcane Metallurgist", palette: "runes, cyan flame, and obsidian" }
];
const STREAK_POWER_DAYS = [
    1, 2, 3, 5, 7, 14, 21, 30, 45, 60, 90, 180, 365, 730
];
const STREAK_AWAY_DAYS = [
    1, 2, 3, 5, 7, 10, 14, 21, 30, 60
];
function metric(metric, threshold) {
    return { metric, threshold };
}
function allOf(...requirements) {
    return { allOf: requirements };
}
function anyOf(...requirements) {
    return { anyOf: requirements };
}
function slugify(value) {
    return value
        .toLowerCase()
        .replace(/['’]/g, "")
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "");
}
function tierForIndex(index, total) {
    const ratio = (index + 1) / total;
    if (ratio > 0.82)
        return "platinum";
    if (ratio > 0.55)
        return "gold";
    if (ratio > 0.25)
        return "silver";
    return "bronze";
}
function difficultyForTier(tier) {
    if (tier === "platinum")
        return "legendary";
    if (tier === "gold")
        return "hard";
    if (tier === "silver")
        return "standard";
    return "intro";
}
function rarityForTier(tier) {
    if (tier === "platinum")
        return "legendary";
    if (tier === "gold")
        return "epic";
    if (tier === "silver")
        return "rare";
    return "common";
}
function itemAssetKey(seed) {
    return `item-${seed.kind}-${slugify(seed.category)}-${slugify(seed.title)}`;
}
function trophy(category, title, requirement, requirementText, summary, reward) {
    return {
        category,
        kind: "trophy",
        title,
        summary,
        requirement,
        requirementText,
        reward: reward ?? `${title} trophy on the Forge shelf`
    };
}
function unlock(category, title, unlockType, requirement, requirementText, summary, rewardPayload) {
    return {
        category,
        kind: "unlock",
        title,
        summary,
        requirement,
        requirementText,
        reward: `${title} cosmetic`,
        unlockType,
        rewardPayload
    };
}
const XP_TROPHIES = [
    trophy("xp_levels", "The First Heat", metric("nonManualXp", 5000), "Earn 5,000 non-manual XP.", "The first real furnace of work is hot enough to be noticed."),
    trophy("xp_levels", "Bellows Graduate", metric("nonManualXp", 10000), "Earn 10,000 non-manual XP.", "Your reward ledger is no longer a spark; it is a system."),
    trophy("xp_levels", "Iron Apprentice", metric("nonManualXp", 20000), "Earn 20,000 non-manual XP.", "You have repeated the work enough that the anvil knows your hand."),
    trophy("xp_levels", "Steel Temper", metric("nonManualXp", 50000), "Earn 50,000 non-manual XP.", "Pressure has started to make the metal cleaner instead of louder."),
    trophy("xp_levels", "Crown of Coals", metric("nonManualXp", 100000), "Earn 100,000 non-manual XP.", "A visible crown for an invisible mountain of completed work."),
    trophy("xp_levels", "Obsidian Master", metric("nonManualXp", 250000), "Earn 250,000 non-manual XP.", "The Forge Smith stops testing your seriousness and starts respecting it."),
    trophy("xp_levels", "Star-Forge Adept", metric("nonManualXp", 500000), "Earn 500,000 non-manual XP.", "Your XP trail burns like a constellation across the operating system."),
    trophy("xp_levels", "Mythic Smith", metric("nonManualXp", 1000000), "Earn 1,000,000 non-manual XP.", "A ridiculous trophy for a ridiculous amount of lived execution.")
];
const XP_UNLOCKS = [
    unlock("xp_levels", "Obsidian Smith", "mascot_skin", metric("nonManualXp", 8000), "Earn 8,000 non-manual XP.", "A dramatic black-iron Forge Smith skin.", { mascotSkin: "obsidian-smith" }),
    unlock("xp_levels", "Molten Progress Bar", "hud_treatment", metric("nonManualXp", 25000), "Earn 25,000 non-manual XP.", "A bright molten XP fill for the level ring.", { hudTreatment: "molten-progress" }),
    unlock("xp_levels", "Apex Level Frame", "icon_frame", metric("nonManualXp", 100000), "Earn 100,000 non-manual XP.", "A high-tier frame for level and trophy icons.", { iconFrame: "apex-level" }),
    unlock("xp_levels", "Masterwork Glow", "celebration_variant", metric("nonManualXp", 250000), "Earn 250,000 non-manual XP.", "A stronger forge-bell reveal for major unlocks.", { celebrationVariant: "masterwork-glow" })
];
const STREAK_TROPHIES = [
    trophy("streaks", "Spark Kept", metric("longestStreakDays", 1), "Play one qualifying day.", "The first day is small, but the forge heard it."),
    trophy("streaks", "Three-Day Furnace", metric("longestStreakDays", 3), "Reach a 3-day streak.", "Three returns make the first shape of discipline."),
    trophy("streaks", "Week-Fire", metric("longestStreakDays", 7), "Reach a 7-day streak.", "Seven days changes the temperature of your life."),
    trophy("streaks", "Twin-Week Bellows", metric("longestStreakDays", 14), "Reach a 14-day streak.", "Two weeks of showing up makes the room expect you."),
    trophy("streaks", "Cinder Discipline", metric("longestStreakDays", 21), "Reach a 21-day streak.", "The fire is not accidental anymore."),
    trophy("streaks", "Monthly Forge", metric("longestStreakDays", 30), "Reach a 30-day streak.", "A full month of returns becomes a personal weather system."),
    trophy("streaks", "Sixty-Day Flame", metric("longestStreakDays", 60), "Reach a 60-day streak.", "The Smith grows stronger because you stopped disappearing."),
    trophy("streaks", "Quarter-Anvil", metric("longestStreakDays", 90), "Reach a 90-day streak.", "Ninety days is not motivation. It is architecture."),
    trophy("streaks", "Half-Year Inferno", metric("longestStreakDays", 180), "Reach a 180-day streak.", "The forge is now a season of your life."),
    trophy("streaks", "Year of Steel", metric("longestStreakDays", 365), "Reach a 365-day streak.", "A year of returns. The anvil has become a witness."),
    trophy("streaks", "Comeback Hammer", metric("comebackAfter7Count", 1), "Return after 7+ missed days and complete a qualifying action.", "You came back after the room went cold."),
    trophy("streaks", "Repair Artist", metric("comebackAfter7Count", 3), "Complete 3 major comebacks.", "Breaking the chain did not become breaking the story."),
    trophy("streaks", "Rust Refuser", allOf(metric("comebackAfter7Count", 5), metric("longestStreakDays", 30)), "Complete 5 major comebacks and reach a 30-day streak.", "You repeatedly turned absence into a new strike."),
    trophy("streaks", "Relentless Return", allOf(metric("comebackAfter7Count", 8), metric("longestStreakDays", 90)), "Complete 8 major comebacks and reach a 90-day streak.", "This trophy is for the part of you that keeps coming back.")
];
const STREAK_UNLOCKS = [
    unlock("streaks", "Bronze Ember Flame", "streak_effect", metric("longestStreakDays", 3), "Reach a 3-day streak.", "A small ember around the streak HUD.", { streakEffect: "bronze-ember" }),
    unlock("streaks", "Blue Forge-Fire", "streak_effect", metric("longestStreakDays", 7), "Reach a 7-day streak.", "A cool blue streak flame.", { streakEffect: "blue-forge-fire" }),
    unlock("streaks", "Violet Arc Flame", "streak_effect", metric("longestStreakDays", 21), "Reach a 21-day streak.", "A sharper violet flame effect.", { streakEffect: "violet-arc" }),
    unlock("streaks", "Molten Crown Fire", "streak_effect", metric("longestStreakDays", 60), "Reach a 60-day streak.", "A crown-like fire treatment for streaks.", { streakEffect: "molten-crown" }),
    unlock("streaks", "Stern Pressure Pose", "mascot_pose", metric("comebackAfter7Count", 1), "Complete a major comeback.", "Unlocks the Smith's stern pressure pose.", { mascotPose: "stern-pressure" }),
    unlock("streaks", "Comeback Pose", "mascot_pose", metric("comebackAfter7Count", 2), "Complete 2 major comebacks.", "Unlocks the Smith's comeback repair pose.", { mascotPose: "comeback" }),
    unlock("streaks", "Awakening Forge Pose", "mascot_pose", metric("longestStreakDays", 30), "Reach a 30-day streak.", "Unlocks the forge awakening mascot pose.", { mascotPose: "awakening-forge" }),
    unlock("streaks", "Yearfire Aura", "streak_effect", metric("longestStreakDays", 365), "Reach a 365-day streak.", "A huge aura for year-scale presence.", { streakEffect: "yearfire-aura" }),
    unlock("streaks", "Old Foundry Shelf", "trophy_shelf", metric("longestStreakDays", 90), "Reach a 90-day streak.", "A warmer trophy shelf skin.", { trophyShelf: "old-foundry" }),
    unlock("streaks", "Relentless Bell", "celebration_variant", metric("longestStreakDays", 180), "Reach a 180-day streak.", "A heavier celebration sound-and-spark treatment.", { celebrationVariant: "relentless-bell" })
];
const TASK_TROPHIES = [
    trophy("tasks", "First Strike", metric("taskCompletionCount", 25), "Complete 25 tasks.", "A real task trail begins."),
    trophy("tasks", "Clean Swing", allOf(metric("taskCompletionCount", 50), metric("focusRunCount", 10)), "Complete 50 tasks and 10 task runs.", "Tasks and time-tracked execution start to converge."),
    trophy("tasks", "Five Rivets", allOf(metric("taskCompletionCount", 75), metric("taskCloseoutReportCount", 5)), "Complete 75 tasks and 5 completion reports.", "You are leaving proof behind, not just checkmarks."),
    trophy("tasks", "Task Blade", allOf(metric("taskCompletionCount", 120), metric("focusRunCount", 25)), "Complete 120 tasks and 25 task runs.", "A sharp blade forged out of repeated finishes."),
    trophy("tasks", "Anvil Marathon", allOf(metric("taskCompletionCount", 300), metric("focusRunCount", 75)), "Complete 300 tasks and 75 task runs.", "The long road achievement for serious execution."),
    trophy("tasks", "Deep-Work Maul", metric("creditedFocusMinutes", 3000), "Log 3,000 credited focus minutes.", "The heavy hammer of deliberate time."),
    trophy("tasks", "Planned Heat", metric("plannedFocusRunCount", 25), "Complete 25 planned task runs.", "You planned the heat before striking the metal."),
    trophy("tasks", "Closeout Scribe", metric("taskCloseoutReportCount", 25), "Write 25 task completion reports.", "The Forge remembers what changed because you wrote it down."),
    trophy("tasks", "Hundred-Hammer Road", metric("taskCompletionCount", 500), "Complete 500 tasks.", "A road paved with finished work."),
    trophy("tasks", "Timebox Knight", allOf(metric("plannedFocusRunCount", 75), metric("creditedFocusMinutes", 7500)), "Complete 75 planned runs and 7,500 focus minutes.", "A trophy for time that obeyed the mission."),
    trophy("tasks", "Backlog Breaker", metric("taskCompletionCount", 750), "Complete 750 tasks.", "The backlog learned to fear your return."),
    trophy("tasks", "Execution Monarch", allOf(metric("taskCompletionCount", 1000), metric("focusRunCount", 200)), "Complete 1,000 tasks and 200 task runs.", "A crown for turning vague intention into finished artifacts."),
    trophy("tasks", "Forge Ledger Exact", metric("taskCloseoutReportCount", 100), "Write 100 task completion reports.", "The most boring discipline becomes the most useful history."),
    trophy("tasks", "The Hammer Does Not Blink", allOf(metric("taskCompletionCount", 1500), metric("creditedFocusMinutes", 15000)), "Complete 1,500 tasks and 15,000 focus minutes.", "For absurd consistency under real load.")
];
const TASK_UNLOCKS = [
    unlock("tasks", "Hammer Cursor", "icon_frame", metric("taskCompletionCount", 75), "Complete 75 tasks.", "A hammer-shaped action accent.", { iconFrame: "hammer-cursor" }),
    unlock("tasks", "Focus Rail Glow", "hud_treatment", metric("focusRunCount", 25), "Complete 25 task runs.", "A task-run glow for compact HUDs.", { hudTreatment: "focus-rail-glow" }),
    unlock("tasks", "Completion Burst", "celebration_variant", metric("taskCloseoutReportCount", 25), "Write 25 completion reports.", "A sharper task-completion burst.", { celebrationVariant: "completion-burst" }),
    unlock("tasks", "Ember Knight", "mascot_skin", metric("taskCompletionCount", 500), "Complete 500 tasks.", "A molten-armored Forge Smith skin for execution mastery.", { mascotSkin: "ember-knight" })
];
const PROJECT_TROPHIES = [
    trophy("projects", "Aligned Spark", metric("goalLinkedTaskCompletionCount", 25), "Complete 25 goal-linked tasks.", "Work starts pointing at something bigger."),
    trophy("projects", "Goal Rivet", allOf(metric("goalLinkedTaskCompletionCount", 50), metric("distinctGoalsWithCompletions", 3)), "Complete 50 goal-linked tasks across 3 goals.", "Several goals now have real rivets, not just titles."),
    trophy("projects", "Strategist's Seal", allOf(metric("goalLinkedTaskCompletionCount", 50), metric("distinctGoalsWithCompletions", 5)), "Complete 50 goal-linked tasks across 5 goals.", "A seal for strategy that survived contact with execution."),
    trophy("projects", "Project Spine", allOf(metric("projectLinkedTaskCompletionCount", 100), metric("activeProjectCount", 5)), "Complete 100 project-linked tasks while maintaining 5 active projects.", "The work has a spine across multiple initiatives."),
    trophy("projects", "Strategy Weld", metric("strategyCount", 10), "Create 10 strategies.", "You forged planning layers instead of improvising every day."),
    trophy("projects", "Purpose Hammer", metric("goalLinkedTaskCompletionCount", 150), "Complete 150 goal-linked tasks.", "The hammer keeps landing where your stated life points."),
    trophy("projects", "Arc Builder", allOf(metric("projectLinkedTaskCompletionCount", 250), metric("distinctGoalsWithCompletions", 8)), "Complete 250 project-linked tasks across 8 goals.", "Multiple arcs moved because you kept building."),
    trophy("projects", "North-Star Foundry", allOf(metric("goalLinkedTaskCompletionCount", 300), metric("strategyCount", 20)), "Complete 300 goal-linked tasks and create 20 strategies.", "The north star is no longer decorative."),
    trophy("projects", "Project Finisher", metric("projectCompletionCount", 5), "Complete 5 projects.", "Finished projects leave heavier evidence than active dreams."),
    trophy("projects", "Life-Work Crown", allOf(metric("projectCompletionCount", 10), metric("goalLinkedTaskCompletionCount", 500)), "Complete 10 projects and 500 goal-linked tasks.", "A crown for long arcs that actually closed."),
    trophy("projects", "Portfolio Anvil", metric("activeProjectCount", 12), "Maintain 12 active projects.", "A large operating portfolio, held without flattening."),
    trophy("projects", "Tracer Bullet Guild", allOf(metric("projectCompletionCount", 15), metric("strategyCount", 35)), "Complete 15 projects and create 35 strategies.", "Strategy and delivery joined hands repeatedly."),
    trophy("projects", "Mountain Moved", metric("goalLinkedTaskCompletionCount", 1000), "Complete 1,000 goal-linked tasks.", "The trophy for moving a mountain one task at a time."),
    trophy("projects", "The Work Had A Spine", allOf(metric("projectCompletionCount", 25), metric("distinctGoalsWithCompletions", 12)), "Complete 25 projects across 12 goals.", "Your life map became execution history.")
];
const PROJECT_UNLOCKS = [
    unlock("projects", "Goal Compass Frame", "icon_frame", metric("goalLinkedTaskCompletionCount", 50), "Complete 50 goal-linked tasks.", "A compass frame for aligned-work trophies.", { iconFrame: "goal-compass" }),
    unlock("projects", "War-Room Iron Shelf", "trophy_shelf", metric("projectLinkedTaskCompletionCount", 150), "Complete 150 project-linked tasks.", "A darker tactical trophy shelf.", { trophyShelf: "war-room-iron" }),
    unlock("projects", "North-Star HUD", "hud_treatment", metric("strategyCount", 20), "Create 20 strategies.", "A strategy-forward HUD treatment.", { hudTreatment: "north-star" }),
    unlock("projects", "Foundry Compass Burst", "celebration_variant", metric("projectCompletionCount", 10), "Complete 10 projects.", "A compass-shaped major reveal.", { celebrationVariant: "foundry-compass" })
];
const WIKI_TROPHIES = [
    trophy("wiki", "First Inscription", metric("wikiPageCount", 50), "Create 50 wiki pages.", "Knowledge has started to become an archive."),
    trophy("wiki", "Memory Rivet", metric("noteCount", 100), "Create 100 notes.", "The system remembers because you gave it material."),
    trophy("wiki", "Archive Ember", allOf(metric("wikiPageCount", 150), metric("wikiLinkCount", 50)), "Create 150 wiki pages and 50 wiki links.", "The archive starts connecting to itself."),
    trophy("wiki", "Knowledge Anvil", allOf(metric("wikiPageCount", 250), metric("wikiLinkCount", 150)), "Create 250 wiki pages and 150 wiki links.", "A serious anvil of memory and links."),
    trophy("wiki", "Living Index", allOf(metric("wikiPageWithSummaryCount", 100), metric("linkedWikiPageCount", 100)), "Maintain 100 wiki pages with summaries and linked entities.", "Pages now carry shape, summary, and relationships."),
    trophy("wiki", "Black Library", allOf(metric("wikiPageCount", 500), metric("wikiLinkCount", 300)), "Create 500 wiki pages and 300 wiki links.", "The great hard knowledge trophy."),
    trophy("wiki", "Obsidian Index", allOf(metric("wikiPageWithSummaryCount", 250), metric("wikiLinkCount", 500)), "Maintain 250 summarized pages and 500 links.", "The archive is no longer just big; it is navigable."),
    trophy("wiki", "Graph Lantern", metric("knowledgeGraphNodeCount", 500), "Reach 500 Knowledge Graph nodes.", "The graph has enough stars to navigate by."),
    trophy("wiki", "Entity Weaver", metric("linkedWikiPageCount", 200), "Link 200 wiki pages to other pages or entities.", "Your memory connects to the operating system."),
    trophy("wiki", "Codex Temper", allOf(metric("wikiPageCount", 750), metric("wikiLinkCount", 750)), "Create 750 wiki pages and 750 wiki links.", "A codex tempered by breadth and connection."),
    trophy("wiki", "Note Furnace", metric("noteCount", 500), "Create 500 notes.", "Raw notes became a real furnace of evidence."),
    trophy("wiki", "Archive Cartographer", allOf(metric("wikiPageWithSummaryCount", 400), metric("linkedWikiPageCount", 300)), "Maintain 400 summarized pages and 300 linked pages.", "You mapped the archive enough that it can map you back."),
    trophy("wiki", "The Shelf Breathes", metric("knowledgeGraphNodeCount", 1000), "Reach 1,000 Knowledge Graph nodes.", "The knowledge system feels alive at a glance."),
    trophy("wiki", "Librarian of Coals", allOf(metric("noteCount", 1000), metric("wikiLinkCount", 1000)), "Create 1,000 notes and 1,000 wiki links.", "A trophy for the long, quiet archive discipline."),
    trophy("wiki", "Living Codex", allOf(metric("wikiPageCount", 1500), metric("wikiPageWithSummaryCount", 750), metric("wikiLinkCount", 1500)), "Create 1,500 pages, 750 summarized pages, and 1,500 links.", "The living memory crown."),
    trophy("wiki", "Memory Starfield", metric("knowledgeGraphNodeCount", 2000), "Reach 2,000 Knowledge Graph nodes.", "The graph becomes a sky.")
];
const WIKI_UNLOCKS = [
    unlock("wiki", "Quiet Library Shelf", "trophy_shelf", metric("wikiPageCount", 150), "Create 150 wiki pages.", "A quiet library shelf skin.", { trophyShelf: "quiet-library" }),
    unlock("wiki", "Rune Page Frame", "icon_frame", metric("wikiLinkCount", 150), "Create 150 wiki links.", "A runic frame for knowledge trophies.", { iconFrame: "rune-page" }),
    unlock("wiki", "Scholar Glass HUD", "hud_treatment", metric("wikiPageWithSummaryCount", 100), "Maintain 100 summarized wiki pages.", "A glassy scholar HUD treatment.", { hudTreatment: "scholar-glass" }),
    unlock("wiki", "Archive Sparks", "celebration_variant", metric("linkedWikiPageCount", 200), "Link 200 wiki pages to other pages or entities.", "A page-flare reveal variant.", { celebrationVariant: "archive-sparks" }),
    unlock("wiki", "Astral Archive Shelf", "trophy_shelf", metric("knowledgeGraphNodeCount", 1000), "Reach 1,000 Knowledge Graph nodes.", "A cosmic trophy shelf for memory work.", { trophyShelf: "astral-archive" }),
    unlock("wiki", "Reading Smith Pose", "mascot_pose", metric("wikiPageWithSummaryCount", 250), "Maintain 250 summarized wiki pages.", "Unlocks the Forge Smith reading pose.", { mascotPose: "reading" })
];
const PSYCHE_TROPHIES = [
    trophy("psyche", "Named Spark", metric("psycheValueCount", 5), "Create 5 Psyche values.", "You named the values the forge should obey."),
    trophy("psyche", "Pattern Tongs", metric("behaviorPatternCount", 5), "Create 5 behavior patterns.", "The recurring loops are now held with tongs."),
    trophy("psyche", "Belief Crucible", metric("beliefEntryCount", 5), "Create 5 belief entries.", "Beliefs entered the fire where they can be worked."),
    trophy("psyche", "Mode Lantern", metric("modeProfileCount", 3), "Create 3 mode profiles.", "The inner cast has names and lantern light."),
    trophy("psyche", "Trigger Witness", metric("triggerReportCount", 3), "Create 3 trigger reports.", "You turned moments of activation into evidence."),
    trophy("psyche", "Mode Cartographer", allOf(metric("modeProfileCount", 8), metric("linkedModeProfileCount", 8)), "Create 8 mode profiles, each linked to a value, behavior, or pattern.", "A map of modes, not a pile of labels."),
    trophy("psyche", "Trigger Alchemist", allOf(metric("triggerReportRichCount", 30), metric("triggerReportCompletedCount", 20)), "Complete 30 rich trigger reports and mark 20 reports beyond draft.", "Activation was turned into material for change."),
    trophy("psyche", "Pattern Breaker", allOf(metric("behaviorPatternCount", 20), metric("behaviorPatternWithReplacementCount", 10)), "Create 20 patterns and link 10 to replacement responses.", "The old loops now have counter-moves."),
    trophy("psyche", "Belief Temperer", allOf(metric("beliefEntryCount", 25), metric("beliefFlexibleAlternativeCount", 25)), "Create 25 beliefs with flexible alternatives.", "Rigid beliefs were heated until they could bend."),
    trophy("psyche", "Value Blade", allOf(metric("psycheValueCount", 10), metric("goalLinkedTaskCompletionCount", 100)), "Create 10 values and complete 100 goal-linked tasks.", "Values and work started cutting in the same direction."),
    trophy("psyche", "Shadow Temper", allOf(metric("modeProfileCount", 12), metric("triggerReportRichCount", 50)), "Create 12 modes and 50 rich trigger reports.", "Shadow material became usable steel."),
    trophy("psyche", "Inner Forge", allOf(metric("psycheValueCount", 12), metric("behaviorPatternCount", 25), metric("beliefFlexibleAlternativeCount", 30)), "Create 12 values, 25 patterns, and 30 flexible beliefs.", "A full inner forge takes shape."),
    trophy("psyche", "Schema Bell", metric("questionnaireRunCount", 10), "Complete 10 questionnaire runs.", "Structured self-observation rang the bell repeatedly."),
    trophy("psyche", "Mode Guide", metric("modeGuideSessionCount", 5), "Complete 5 mode guide sessions.", "Guided mode work became an actual practice."),
    trophy("psyche", "Repair Script", metric("behaviorCount", 10), "Create 10 Psyche behaviors.", "Behaviors now carry repair plans, not just names."),
    trophy("psyche", "Flexible Self", metric("beliefFlexibleAlternativeCount", 50), "Create 50 beliefs with flexible alternatives.", "A trophy for not letting old beliefs remain iron cages."),
    trophy("psyche", "Trigger Cartography", metric("triggerReportRichCount", 100), "Create 100 rich trigger reports.", "The map of activation became detailed enough to steer by."),
    trophy("psyche", "The Inner Council", allOf(metric("modeProfileCount", 20), metric("behaviorCount", 20), metric("beliefFlexibleAlternativeCount", 75)), "Create 20 modes, 20 behaviors, and 75 flexible beliefs.", "The inner system became a council instead of noise.")
];
const PSYCHE_UNLOCKS = [
    unlock("psyche", "Scholar Smith", "mascot_skin", metric("psycheValueCount", 7), "Create 7 Psyche values.", "A wise, bookish Forge Smith skin.", { mascotSkin: "scholar-smith" }),
    unlock("psyche", "Wise Smith Pose", "mascot_pose", metric("modeProfileCount", 3), "Create 3 mode profiles.", "Unlocks the wise mentor pose.", { mascotPose: "wise" }),
    unlock("psyche", "Reflection Frame", "icon_frame", metric("beliefEntryCount", 10), "Create 10 belief entries.", "A reflective frame for Psyche trophies.", { iconFrame: "reflection" }),
    unlock("psyche", "Mode Lens HUD", "hud_treatment", metric("modeProfileCount", 8), "Create 8 mode profiles.", "A HUD tuned to Psyche work.", { hudTreatment: "mode-lens" }),
    unlock("psyche", "Shadow Smith", "mascot_skin", metric("triggerReportRichCount", 25), "Create 25 rich trigger reports.", "A darker Smith skin for shadow work.", { mascotSkin: "shadow-smith" }),
    unlock("psyche", "Arcane Metallurgist", "mascot_skin", metric("beliefFlexibleAlternativeCount", 25), "Create 25 beliefs with flexible alternatives.", "A rune-lit Smith skin for deep reflection.", { mascotSkin: "arcane-metallurgist" }),
    unlock("psyche", "Inner-Fire Halo", "streak_effect", metric("psycheValueCount", 10), "Create 10 Psyche values.", "A halo-like flame for reflective momentum.", { streakEffect: "inner-fire-halo" }),
    unlock("psyche", "Mode Lantern Reveal", "celebration_variant", metric("modeProfileCount", 12), "Create 12 mode profiles.", "A lantern reveal for Psyche unlocks.", { celebrationVariant: "mode-lantern" }),
    unlock("psyche", "Therapist's Shelf", "trophy_shelf", metric("triggerReportRichCount", 50), "Create 50 rich trigger reports.", "A quiet shelf for inner-work trophies.", { trophyShelf: "therapist-shelf" }),
    unlock("psyche", "Prismatic Crucible", "celebration_variant", metric("beliefFlexibleAlternativeCount", 50), "Create 50 flexible belief alternatives.", "A prismatic reveal for belief work.", { celebrationVariant: "prismatic-crucible" })
];
const HABIT_TROPHIES = [
    trophy("habits", "Ritual Spark", metric("habitAlignedCount", 25), "Record 25 aligned habit check-ins.", "Your recurring commitments have started to leave marks."),
    trophy("habits", "Routine Rivet", metric("habitAlignedCount", 75), "Record 75 aligned habit check-ins.", "The habit rail is no longer decorative."),
    trophy("habits", "Habit Heat", allOf(metric("habitAlignedCount", 150), metric("habitStreakMax", 14)), "Record 150 aligned check-ins and a 14-day habit streak.", "One behavior got hot enough to shape you."),
    trophy("habits", "Ritual Iron", metric("habitAlignedCount", 365), "Record 365 aligned habit check-ins.", "The hard habit trophy."),
    trophy("habits", "Recovery Shield", metric("recoveryEventCount", 50), "Earn 50 recovery rewards.", "Recovery was treated as part of the work."),
    trophy("habits", "Life-Force Alloy", metric("lifeForceSnapshotCount", 100), "Record 100 Life Force day snapshots.", "Energy accounting became a usable alloy."),
    trophy("habits", "Sleep Temper", metric("healthSleepSessionCount", 120), "Import 120 sleep sessions.", "Sleep became evidence, not a guess."),
    trophy("habits", "Vitality Forge", allOf(metric("workoutSessionCount", 100), metric("healthSleepSessionCount", 200)), "Import 100 workouts and 200 sleep sessions.", "Body data and execution entered the same forge.")
];
const HABIT_UNLOCKS = [
    unlock("habits", "Recovery Blue Flame", "streak_effect", metric("recoveryEventCount", 20), "Earn 20 recovery rewards.", "A cooler recovery flame.", { streakEffect: "recovery-blue" }),
    unlock("habits", "Ritual Check Glow", "hud_treatment", metric("habitAlignedCount", 75), "Record 75 aligned habit check-ins.", "A habit-check glow for the HUD.", { hudTreatment: "ritual-check" }),
    unlock("habits", "Storm Forger", "mascot_skin", metric("workoutSessionCount", 50), "Import 50 workouts.", "A storm-lit Smith skin for movement arcs.", { mascotSkin: "storm-forger" }),
    unlock("habits", "Clockwork Smith", "mascot_skin", metric("habitAlignedCount", 150), "Record 150 aligned habit check-ins.", "A clockwork skin for ritual precision.", { mascotSkin: "clockwork-smith" }),
    unlock("habits", "Vital Flame", "streak_effect", metric("healthSleepSessionCount", 90), "Import 90 sleep sessions.", "A vital-sign flame around streak indicators.", { streakEffect: "vital-flame" }),
    unlock("habits", "Life-Force Frame", "icon_frame", metric("lifeForceSnapshotCount", 100), "Record 100 Life Force snapshots.", "An AP-inspired frame for body trophies.", { iconFrame: "life-force" }),
    unlock("habits", "Steady-State Aura", "streak_effect", metric("habitStreakMax", 60), "Reach a 60-day habit streak.", "An aura for long stable rituals.", { streakEffect: "steady-state" }),
    unlock("habits", "Celestial Smith", "mascot_skin", allOf(metric("workoutSessionCount", 100), metric("healthSleepSessionCount", 200)), "Import 100 workouts and 200 sleep sessions.", "A celestial skin for body stewardship.", { mascotSkin: "celestial-smith" })
];
const AGENT_TROPHIES = [
    trophy("agents", "Companion Spark", metric("agentActionCount", 5), "Record 5 agent actions.", "The first sign of a working human-agent council."),
    trophy("agents", "Bot Bellows", metric("agentCompletedActionCount", 20), "Complete 20 agent actions.", "Agents are not just present; they are moving work."),
    trophy("agents", "Council Spark", metric("collaborationRewardCount", 50), "Earn 50 collaboration rewards.", "The collaboration trophy for meaningful assisted work."),
    trophy("agents", "Guild Forge", allOf(metric("agentCompletedActionCount", 100), metric("collaborationRewardCount", 100)), "Complete 100 agent actions and earn 100 collaboration rewards.", "The Forge has become a small guild.")
];
const AGENT_UNLOCKS = [
    unlock("agents", "Guild Badge Frame", "icon_frame", metric("agentCompletedActionCount", 20), "Complete 20 agent actions.", "A guild frame for agent trophies.", { iconFrame: "guild-badge" }),
    unlock("agents", "Council Sparks Reveal", "celebration_variant", metric("collaborationRewardCount", 50), "Earn 50 collaboration rewards.", "A council-sparks reveal for collaboration.", { celebrationVariant: "council-sparks" })
];
const SEEDS = [
    ...XP_TROPHIES,
    ...XP_UNLOCKS,
    ...STREAK_TROPHIES,
    ...STREAK_UNLOCKS,
    ...TASK_TROPHIES,
    ...TASK_UNLOCKS,
    ...PROJECT_TROPHIES,
    ...PROJECT_UNLOCKS,
    ...WIKI_TROPHIES,
    ...WIKI_UNLOCKS,
    ...PSYCHE_TROPHIES,
    ...PSYCHE_UNLOCKS,
    ...HABIT_TROPHIES,
    ...HABIT_UNLOCKS,
    ...AGENT_TROPHIES,
    ...AGENT_UNLOCKS
];
function buildCatalog() {
    let sortOrder = 0;
    let trophySheetIndex = 0;
    let unlockSheetIndex = 0;
    const categorySeen = new Map();
    return SEEDS.map((seed) => {
        const config = CATEGORY_CONFIGS.find((entry) => entry.id === seed.category);
        if (!config) {
            throw new Error(`Unknown gamification category ${seed.category}`);
        }
        const seen = categorySeen.get(seed.category) ?? { trophy: 0, unlock: 0 };
        const categoryKindIndex = seen[seed.kind];
        seen[seed.kind] += 1;
        categorySeen.set(seed.category, seen);
        const categoryKindTotal = seed.kind === "trophy" ? config.trophyCount : config.unlockCount;
        const tier = tierForIndex(categoryKindIndex, categoryKindTotal);
        const id = `${seed.kind}-${slugify(seed.category)}-${slugify(seed.title)}`;
        const sheetIndex = seed.kind === "trophy" ? trophySheetIndex++ : unlockSheetIndex++;
        return {
            id,
            kind: seed.kind,
            category: seed.category,
            tier,
            difficulty: difficultyForTier(tier),
            hidden: seed.hidden ?? false,
            title: seed.title,
            summary: seed.summary,
            requirement: seed.requirement,
            requirementText: seed.requirementText,
            reward: seed.reward,
            unlockType: seed.kind === "unlock" ? seed.unlockType ?? "icon_frame" : null,
            rewardPayload: seed.kind === "unlock"
                ? seed.rewardPayload ?? {}
                : { trophyId: id },
            assetKey: itemAssetKey(seed),
            sheetKey: `${seed.kind === "trophy" ? "trophies" : "unlocks"}-r${Math.floor(sheetIndex / 10) + 1}-c${(sheetIndex % 10) + 1}`,
            rarity: rarityForTier(tier),
            sortOrder: sortOrder++
        };
    });
}
export const GAMIFICATION_CATALOG = buildCatalog();
function assertCatalog() {
    if (GAMIFICATION_CATALOG.length !== 144) {
        throw new Error(`GAMIFICATION_CATALOG must contain exactly 144 items; found ${GAMIFICATION_CATALOG.length}.`);
    }
    const trophyCount = GAMIFICATION_CATALOG.filter((item) => item.kind === "trophy").length;
    const unlockCount = GAMIFICATION_CATALOG.filter((item) => item.kind === "unlock").length;
    if (trophyCount !== 96 || unlockCount !== 48) {
        throw new Error(`GAMIFICATION_CATALOG must contain 96 trophies and 48 unlocks; found ${trophyCount}/${unlockCount}.`);
    }
    for (const config of CATEGORY_CONFIGS) {
        const trophies = GAMIFICATION_CATALOG.filter((item) => item.category === config.id && item.kind === "trophy").length;
        const unlocks = GAMIFICATION_CATALOG.filter((item) => item.category === config.id && item.kind === "unlock").length;
        if (trophies !== config.trophyCount || unlocks !== config.unlockCount) {
            throw new Error(`${config.id} expected ${config.trophyCount}/${config.unlockCount}, found ${trophies}/${unlocks}.`);
        }
    }
    const assetKeys = new Set(GAMIFICATION_CATALOG.map((item) => item.assetKey));
    if (assetKeys.size !== GAMIFICATION_CATALOG.length) {
        throw new Error("Every trophy and unlock must have a unique asset key.");
    }
}
assertCatalog();
export const GAMIFICATION_CATEGORIES = CATEGORY_CONFIGS.map((config) => ({
    id: config.id,
    label: config.label
}));
export const GAMIFICATION_MASCOT_STATE_KEYS = Array.from({ length: 30 }, (_, index) => `mascot-state-${String(index + 1).padStart(3, "0")}`);
export const GAMIFICATION_STREAK_POWER_DAY_KEYS = STREAK_POWER_DAYS.map((day, index) => [
    day,
    `mascot-state-${String(17 + index).padStart(3, "0")}`
]);
export const GAMIFICATION_STREAK_AWAY_DAY_KEYS = STREAK_AWAY_DAYS.map((day, index) => [
    day,
    `mascot-state-${String(10 - index).padStart(3, "0")}`
]);
export const GAMIFICATION_MASCOT_SKINS = MASCOT_SKINS;
export const GAMIFICATION_MASCOT_KEYS = GAMIFICATION_MASCOT_STATE_KEYS;
if (GAMIFICATION_MASCOT_KEYS.length !== 30) {
    throw new Error(`GAMIFICATION_MASCOT_KEYS must contain exactly 30 mascot/state keys; found ${GAMIFICATION_MASCOT_KEYS.length}.`);
}
function manifestColor(item) {
    switch (item.category) {
        case "xp_levels":
            return "#f59e0b";
        case "streaks":
            return "#fb923c";
        case "tasks":
            return "#f97316";
        case "projects":
            return "#38bdf8";
        case "wiki":
            return "#a78bfa";
        case "psyche":
            return "#8b5cf6";
        case "habits":
            return "#4ade80";
        case "agents":
            return "#22d3ee";
        default:
            return "#f59e0b";
    }
}
function assetPromptForItem(item) {
    return [
        "cinematic stylized blacksmith game icon",
        item.category.replace(/_/g, " "),
        item.kind,
        item.title,
        "obsidian iron, ember gold, cool violet and cyan steel highlights, no text"
    ].join(", ");
}
const itemManifestEntries = Object.fromEntries(GAMIFICATION_CATALOG.map((item) => [
    item.assetKey,
    {
        key: item.assetKey,
        role: "item",
        itemKind: item.kind,
        alt: `${item.title} ${item.kind} icon.`,
        dominantColor: manifestColor(item),
        tierFrame: item.tier,
        sourcePath: `gamification/source/themes/dark-fantasy/items/${item.assetKey}.png`,
        spritePath: `gamification/sprites/themes/dark-fantasy/items/${item.assetKey}-{size}.webp`,
        sheetKey: item.sheetKey,
        prompt: assetPromptForItem(item)
    }
]));
const mascotManifestEntries = Object.fromEntries(GAMIFICATION_MASCOT_KEYS.map((key) => {
    const stateNumber = Number(key.replace("mascot-state-", ""));
    const isAway = stateNumber <= 10;
    const isPower = stateNumber >= 17;
    return [
        key,
        {
            key,
            role: isPower || isAway ? "streak" : "mascot",
            alt: isAway
                ? "The Forge Smith in a safe cold-forge absence state."
                : "The Forge Smith mascot in a dramatic blacksmith game-art pose.",
            dominantColor: isAway ? "#64748b" : isPower ? "#fb923c" : "#38bdf8",
            tierFrame: "none",
            sourcePath: `gamification/source/themes/dark-fantasy/mascots/${key}.png`,
            spritePath: `gamification/sprites/themes/dark-fantasy/mascots/${key}-{size}.webp`,
            sheetKey: null,
            prompt: "dramatic Forge Smith blacksmith mascot, premium game art, no text, no watermark"
        }
    ];
}));
export const GAMIFICATION_ASSET_MANIFEST = {
    ...itemManifestEntries,
    ...mascotManifestEntries
};
