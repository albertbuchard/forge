const RETRIEVAL_DATE = "2026-04-06";
function option(key, label, value, description = "") {
    return { key, label, value, description };
}
function item(id, prompt, options, extra = {}) {
    return {
        id,
        prompt,
        shortLabel: "",
        description: "",
        helperText: "",
        required: true,
        visibility: null,
        tags: [],
        options,
        ...extra
    };
}
function buildDefinition(options) {
    return {
        locale: "en",
        instructions: options.instructions,
        completionNote: options.completionNote ?? "",
        presentationMode: options.presentationMode,
        responseStyle: options.responseStyle,
        itemIds: options.items.map((entry) => entry.id),
        items: options.items,
        sections: options.sections.map((section) => ({
            id: section.id,
            title: section.title,
            description: section.description ?? "",
            visibility: null,
            itemIds: section.itemIds
        })),
        pageSize: options.pageSize ?? null
    };
}
function buildProvenance(options) {
    return {
        retrievalDate: RETRIEVAL_DATE,
        sourceClass: options.sourceClass,
        scoringNotes: options.scoringNotes,
        sources: options.sources.map((source) => ({
            label: source.label,
            url: source.url,
            citation: source.citation,
            notes: source.notes ?? ""
        }))
    };
}
const PHQ_OPTIONS = [
    option("not_at_all", "Not at all", 0),
    option("several_days", "Several days", 1),
    option("more_than_half", "More than half the days", 2),
    option("nearly_every_day", "Nearly every day", 3)
];
const GAD_OPTIONS = PHQ_OPTIONS;
const WHO5_OPTIONS = [
    option("all_of_time", "All of the time", 5),
    option("most_of_time", "Most of the time", 4),
    option("more_than_half", "More than half of the time", 3),
    option("less_than_half", "Less than half of the time", 2),
    option("some_of_time", "Some of the time", 1),
    option("at_no_time", "At no time", 0)
];
const PCL_OPTIONS = [
    option("not_at_all", "Not at all", 0),
    option("a_little_bit", "A little bit", 1),
    option("moderately", "Moderately", 2),
    option("quite_a_bit", "Quite a bit", 3),
    option("extremely", "Extremely", 4)
];
const AUDIT_FREQUENCY_OPTIONS = [
    option("never", "Never", 0),
    option("monthly_or_less", "Monthly or less", 1),
    option("two_to_four_month", "2 to 4 times a month", 2),
    option("two_to_three_week", "2 to 3 times a week", 3),
    option("four_or_more_week", "4 or more times a week", 4)
];
const AUDIT_QUANTITY_OPTIONS = [
    option("one_or_two", "1 or 2", 0),
    option("three_or_four", "3 or 4", 1),
    option("five_or_six", "5 or 6", 2),
    option("seven_to_nine", "7 to 9", 3),
    option("ten_plus", "10 or more", 4)
];
const AUDIT_CONSEQUENCE_OPTIONS = [
    option("never", "Never", 0),
    option("less_than_monthly", "Less than monthly", 1),
    option("monthly", "Monthly", 2),
    option("weekly", "Weekly", 3),
    option("daily_or_almost_daily", "Daily or almost daily", 4)
];
const AUDIT_REFERRAL_OPTIONS = [
    option("no", "No", 0),
    option("yes_not_last_year", "Yes, but not in the last year", 2),
    option("yes_last_year", "Yes, during the last year", 4)
];
const YES_NO_OPTIONS = [
    option("no", "No", 0),
    option("yes", "Yes", 1)
];
const YSQ_OPTIONS = [
    option("1", "1 · Completely untrue of me", 1),
    option("2", "2 · Mostly untrue of me", 2),
    option("3", "3 · Slightly more true than untrue", 3),
    option("4", "4 · Moderately true of me", 4),
    option("5", "5 · Mostly true of me", 5),
    option("6", "6 · Describes me perfectly", 6)
];
function numericScore(key, label, expression, extra = {}) {
    return {
        key,
        label,
        description: "",
        valueType: "number",
        expression,
        dependsOnItemIds: [],
        missingPolicy: { mode: "require_all" },
        bands: [],
        roundTo: null,
        unitLabel: "",
        ...extra
    };
}
const PHQ_ITEMS = [
    item("phq_1", "Little interest or pleasure in doing things", PHQ_OPTIONS),
    item("phq_2", "Feeling down, depressed, or hopeless", PHQ_OPTIONS),
    item("phq_3", "Trouble falling or staying asleep, or sleeping too much", PHQ_OPTIONS),
    item("phq_4", "Feeling tired or having little energy", PHQ_OPTIONS),
    item("phq_5", "Poor appetite or overeating", PHQ_OPTIONS),
    item("phq_6", "Feeling bad about yourself — or that you are a failure or have let yourself or your family down", PHQ_OPTIONS),
    item("phq_7", "Trouble concentrating on things, such as reading the newspaper or watching television", PHQ_OPTIONS),
    item("phq_8", "Moving or speaking so slowly that other people could have noticed? Or the opposite — being so fidgety or restless that you have been moving around a lot more than usual", PHQ_OPTIONS),
    item("phq_9", "Thoughts that you would be better off dead or of hurting yourself in some way", PHQ_OPTIONS)
];
const GAD_ITEMS = [
    item("gad_1", "Feeling nervous, anxious or on edge", GAD_OPTIONS),
    item("gad_2", "Not being able to stop or control worrying", GAD_OPTIONS),
    item("gad_3", "Worrying too much about different things", GAD_OPTIONS),
    item("gad_4", "Trouble relaxing", GAD_OPTIONS),
    item("gad_5", "Being so restless that it is hard to sit still", GAD_OPTIONS),
    item("gad_6", "Becoming easily annoyed or irritable", GAD_OPTIONS),
    item("gad_7", "Feeling afraid as if something awful might happen", GAD_OPTIONS)
];
const WHO5_ITEMS = [
    item("who5_1", "I have felt cheerful and in good spirits", WHO5_OPTIONS),
    item("who5_2", "I have felt calm and relaxed", WHO5_OPTIONS),
    item("who5_3", "I have felt active and vigorous", WHO5_OPTIONS),
    item("who5_4", "I woke up feeling fresh and rested", WHO5_OPTIONS),
    item("who5_5", "My daily life has been filled with things that interest me", WHO5_OPTIONS)
];
const PCL_ITEMS = [
    item("pcl_1", "Repeated, disturbing, and unwanted memories of the stressful experience?", PCL_OPTIONS),
    item("pcl_2", "Repeated, disturbing dreams of the stressful experience?", PCL_OPTIONS),
    item("pcl_3", "Suddenly feeling or acting as if the stressful experience were actually happening again (as if you were actually back there reliving it)?", PCL_OPTIONS),
    item("pcl_4", "Feeling very upset when something reminded you of the stressful experience?", PCL_OPTIONS),
    item("pcl_5", "Having strong physical reactions when something reminded you of the stressful experience (for example, heart pounding, trouble breathing, sweating)?", PCL_OPTIONS),
    item("pcl_6", "Avoiding memories, thoughts, or feelings related to the stressful experience?", PCL_OPTIONS),
    item("pcl_7", "Avoiding external reminders of the stressful experience (for example, people, places, conversations, activities, objects, or situations)?", PCL_OPTIONS),
    item("pcl_8", "Trouble remembering important parts of the stressful experience?", PCL_OPTIONS),
    item("pcl_9", "Having strong negative beliefs about yourself, other people, or the world?", PCL_OPTIONS),
    item("pcl_10", "Blaming yourself or someone else for the stressful experience or what happened after it?", PCL_OPTIONS),
    item("pcl_11", "Having strong negative feelings such as fear, horror, anger, guilt, or shame?", PCL_OPTIONS),
    item("pcl_12", "Loss of interest in activities that you used to enjoy?", PCL_OPTIONS),
    item("pcl_13", "Feeling distant or cut off from other people?", PCL_OPTIONS),
    item("pcl_14", "Trouble experiencing positive feelings (for example, being unable to feel happiness or have loving feelings for people close to you)?", PCL_OPTIONS),
    item("pcl_15", "Irritable behavior, angry outbursts, or acting aggressively?", PCL_OPTIONS),
    item("pcl_16", "Taking too many risks or doing things that could cause you harm?", PCL_OPTIONS),
    item("pcl_17", "Being “superalert” or watchful or on guard?", PCL_OPTIONS),
    item("pcl_18", "Feeling jumpy or easily startled?", PCL_OPTIONS),
    item("pcl_19", "Having difficulty concentrating?", PCL_OPTIONS),
    item("pcl_20", "Trouble falling or staying asleep?", PCL_OPTIONS)
];
const AUDIT_ITEMS = [
    item("audit_1", "How often do you have a drink containing alcohol?", AUDIT_FREQUENCY_OPTIONS),
    item("audit_2", "How many drinks containing alcohol do you have on a typical day when you are drinking?", AUDIT_QUANTITY_OPTIONS, { visibility: { script: "audit_1 > 0" } }),
    item("audit_3", "How often do you have six or more drinks on one occasion?", AUDIT_CONSEQUENCE_OPTIONS, { visibility: { script: "audit_1 > 0" } }),
    item("audit_4", "During the last year, how often have you found that you were not able to stop drinking once you had started?", AUDIT_CONSEQUENCE_OPTIONS, { visibility: { script: "audit_1 > 0" } }),
    item("audit_5", "During the last year, how often have you failed to do what was normally expected from you because of drinking?", AUDIT_CONSEQUENCE_OPTIONS, { visibility: { script: "audit_1 > 0" } }),
    item("audit_6", "During the last year, how often have you needed a first drink in the morning to get yourself going after a heavy drinking session?", AUDIT_CONSEQUENCE_OPTIONS, { visibility: { script: "audit_1 > 0" } }),
    item("audit_7", "During the last year, how often have you had a feeling of guilt or remorse after drinking?", AUDIT_CONSEQUENCE_OPTIONS, { visibility: { script: "audit_1 > 0" } }),
    item("audit_8", "During the last year, how often have you been unable to remember what happened the night before because of your drinking?", AUDIT_CONSEQUENCE_OPTIONS, { visibility: { script: "audit_1 > 0" } }),
    item("audit_9", "Have you or someone else been injured because of your drinking?", AUDIT_REFERRAL_OPTIONS, { visibility: { script: "audit_1 > 0" } }),
    item("audit_10", "Has a relative or friend or a doctor or another health worker been concerned about your drinking or suggested you cut down?", AUDIT_REFERRAL_OPTIONS, { visibility: { script: "audit_1 > 0" } })
];
const SRQ_ITEMS = [
    item("srq_1", "Do you often have headaches?", YES_NO_OPTIONS),
    item("srq_2", "Is your appetite poor?", YES_NO_OPTIONS),
    item("srq_3", "Do you sleep badly?", YES_NO_OPTIONS),
    item("srq_4", "Are you easily frightened?", YES_NO_OPTIONS),
    item("srq_5", "Do your hands shake?", YES_NO_OPTIONS),
    item("srq_6", "Do you feel nervous, tense or worried?", YES_NO_OPTIONS),
    item("srq_7", "Is your digestion poor?", YES_NO_OPTIONS),
    item("srq_8", "Do you have trouble thinking clearly?", YES_NO_OPTIONS),
    item("srq_9", "Do you feel unhappy?", YES_NO_OPTIONS),
    item("srq_10", "Do you cry more than usual?", YES_NO_OPTIONS),
    item("srq_11", "Do you find it difficult to enjoy your daily activities?", YES_NO_OPTIONS),
    item("srq_12", "Do you find it difficult to make decisions?", YES_NO_OPTIONS),
    item("srq_13", "Is your daily work suffering?", YES_NO_OPTIONS),
    item("srq_14", "Are you unable to play a useful part in life?", YES_NO_OPTIONS),
    item("srq_15", "Have you lost interest in things?", YES_NO_OPTIONS),
    item("srq_16", "Do you feel that you are a worthless person?", YES_NO_OPTIONS),
    item("srq_17", "Has the thought of ending your life been on your mind?", YES_NO_OPTIONS),
    item("srq_18", "Do you feel tired all the time?", YES_NO_OPTIONS),
    item("srq_19", "Do you have uncomfortable feelings in your stomach?", YES_NO_OPTIONS),
    item("srq_20", "Are you easily tired?", YES_NO_OPTIONS)
];
const YSQ_ITEM_TEXTS = [
    "I haven't gotten enough love and attention.",
    "For the most part, I haven't had someone to depend on for advice and emotional support.",
    "For much of my life, I haven't had someone who wanted to get close to me and spend a lot of time with me.",
    "For much of my life, I haven't felt that I am special to someone.",
    "I have rarely had a strong person to give me sound advice or direction when I'm not sure what to do. *(ed)",
    "I worry that people I feel close to will leave me or abandon me.",
    "I don't feel that important relationships will last; I expect them to end.",
    "I feel addicted to partners who can't be there for me in a committed way.",
    "I become upset when someone leaves me alone, even for a short period of time.",
    "I can't let myself get very close to other people, because I can't be sure they'll always be there.",
    "People close to me have been very unpredictable: one moment they're available and nice; the next, they're angry, upset, self-absorbed, fighting, etc.",
    "I need other people so much that I worry about losing them.",
    "I can't be myself or express what I really feel, or people will leave me. *(ab)",
    "I feel that I can't let my guard down in the presence of other people, or else they will intentionally hurt me.",
    "It is only a matter of time before someone betrays me.",
    "I have a great deal of difficulty trusting people.",
    "I set up \"tests\" for other people, to see if they are telling me the truth and are well-intentioned.",
    "I subscribe to the belief: \"Control or be controlled.\" *(ma)",
    "I'm fundamentally different from other people.",
    "I don't belong; I'm a loner.",
    "I always feel on the outside of groups.",
    "No one really understands me.",
    "I sometimes feel as if I'm an alien. *(si)",
    "No one I desire would want to stay close to me if he/she knew the real me.",
    "I am inherently flawed and defective.",
    "I feel that I'm not lovable.",
    "I am too unacceptable in very basic ways to reveal myself to other people.",
    "When people like me, I feel I am fooling them.",
    "I cannot understand how anyone could love me. *(de)",
    "Almost nothing I do at work (or school) is as good as other people can do.",
    "Most other people are more capable than I am in areas of work (or school) and achievement.",
    "I'm a failure.",
    "I'm not as talented as most people are at their work (or at school).",
    "I often feel embarrassed around other people, because I don't measure up to them in terms of my accomplishments.",
    "I often compare my accomplishments with others and feel that they are much more successful. *(fa)",
    "I do not feel capable of getting by on my own in everyday life.",
    "I believe that other people can take care of me better than I can take care of myself.",
    "I have trouble tackling new tasks outside of work unless I have someone to guide me.",
    "I screw up everything I try, even outside of work (or school).",
    "If I trust my own judgment in everyday situations, I'll make the wrong decision.",
    "I feel that I need someone I can rely on to give me advice about practical issues.",
    "I feel more like a child than an adult when it comes to handling everyday responsibilities.",
    "I find the responsibilities of everyday life overwhelming. *(di)",
    "I feel that a disaster (natural, criminal, financial, or medical) could strike at any moment.",
    "I worry about being attacked.",
    "I take great precautions to avoid getting sick or hurt.",
    "I worry that I'm developing a serious illness, even though nothing serious has been diagnosed by a doctor.",
    "I worry a lot about the bad things happening in the world: crime, pollution, etc.",
    "I feel that the world is a dangerous place. *(vh)",
    "My parent(s) and I tend to be overinvolved in each other's lives and problems.",
    "It is very difficult for my parent(s) and me to keep intimate details from each other, without feeling betrayed or guilty.",
    "My parent(s) and I must speak to each other almost every day, or else one of us feels guilty, hurt, disappointed, or alone.",
    "I often feel that I do not have a separate identity from my parents or partner.",
    "It is very difficult for me to maintain any distance from the people I am intimate with; I have trouble keeping any separate sense of myself.",
    "I often feel that I have no privacy when it comes to my parent(s) or partner.",
    "I feel that my parent(s) are, or would be, very hurt about my living on my own, away from them. *(em)",
    "I believe that if I do what I want, I'm only asking for trouble.",
    "In relationships, I let the other person have the upper hand.",
    "I've always let others make choices for me, so I really don't know what I want for myself.",
    "I worry a lot about pleasing other people, so they won't reject me.",
    "I will go to much greater lengths than most people to avoid confrontations. *(sb)",
    "I give more to other people than I get back in return.",
    "I'm the one who usually ends up taking care of the people I'm close to.",
    "No matter how busy I am, I can always find time for others.",
    "I've always been the one who listens to everyone else's problems.",
    "Other people see me as doing too much for others and not enough for myself.",
    "No matter how much I give; I feel it is never enough. *(ss)",
    "I worry about losing control of my actions.",
    "I worry that I might seriously harm someone physically or emotionally if my anger gets out of control.",
    "I feel that I must control my emotions and impulses, or something bad is likely to happen.",
    "A lot of anger and resentment build up inside of me that I don't express. *(flc)",
    "I am too self-conscious to show positive feelings to others (e.g., affection, showing I care).",
    "I find it embarrassing to express my feelings to others.",
    "I find it hard to be warm and spontaneous.",
    "I control myself so much that people think I am unemotional.",
    "People see me as uptight emotionally. *(ec)",
    "I must be the best at most of what I do; I can't accept second best.",
    "I strive to keep almost everything in perfect order.",
    "I have so much to accomplish that there is almost no time to really relax.",
    "I must meet all my responsibilities.",
    "I often sacrifice pleasure and happiness to meet my own standards.",
    "I can't let myself off the hook easily or make excuses for my mistakes.",
    "I always must be Number One, in terms of my performance. *(us)",
    "I have a lot of trouble accepting \"no\" for an answer when I want something from other people.",
    "I hate to be constrained or kept from doing what I want.",
    "I feel that I shouldn't have to follow the normal rules and conventions other people do.",
    "I often find that I am so involved in my own priorities that I don't have time to give to friends or family.",
    "People often tell me I am very controlling about the ways things are done.",
    "I can't tolerate other people telling me what to do. *(et)",
    "I can't seem to discipline myself to complete routine or boring tasks.",
    "Often I allow myself to carry through on impulses and express emotions that get me into trouble or hurt other people.",
    "I get bored very easily.",
    "When tasks become difficult, I usually cannot persevere and complete them.",
    "I can't force myself to do things I don't enjoy, even when I know it's for my own good.",
    "I have rarely been able to stick to my resolutions.",
    "I often do things impulsively that I later regret. *(is)",
    "It is important to me to be liked by almost everyone I know.",
    "I change myself depending on the people I’m with, so they’ll like me more.",
    "My self-esteem is based mostly on how other people view me.",
    "Even if I don’t like someone, I still want him or her to like me.",
    "Unless I get a lot of attention from others, I feel less important. *(as)",
    "You can’t be too careful; something will almost always go wrong.",
    "I worry that a wrong decision could lead to disaster.",
    "I often obsess over minor decisions, because the consequences of making a mistake seem so serious.",
    "I feel better assuming things will not work out for me, so that I don’t feel disappointed if things go wrong.",
    "I tend to be pessimistic.",
    "If people get too enthusiastic about something, I become uncomfortable and feel like warning them of what could go wrong. *(np)",
    "If I make a mistake, I deserve to be punished.",
    "There is no excuse if I make a mistake.",
    "If I don’t do the job, I should suffer the consequences.",
    "It doesn’t matter why I make a mistake; I should pay the price when I do something wrong.",
    "I’m a bad person who deserves to be punished. *(pu-s)",
    "People who don’t “pull their own weight” should get punished in some way.",
    "Most of the time, I don’t accept the excuses other people make. They’re just not willing to accept responsibility and pay the consequences.",
    "I hold grudges, even after someone has apologised.",
    "I get angry when people make excuses for themselves or blame other people for their problems. *(pu-o)"
];
const YSQ_SCHEMA_GROUPS = [
    { key: "emotional_deprivation", title: "Emotional Deprivation", start: 1, end: 5 },
    { key: "abandonment", title: "Abandonment", start: 6, end: 13 },
    { key: "mistrust", title: "Mistrust", start: 14, end: 18 },
    { key: "social_isolation", title: "Social Isolation", start: 19, end: 23 },
    { key: "defectiveness", title: "Defectiveness", start: 24, end: 29 },
    { key: "failure", title: "Failure", start: 30, end: 35 },
    { key: "dependence", title: "Dependence", start: 36, end: 43 },
    { key: "vulnerability_to_harm", title: "Vulnerability to Harm", start: 44, end: 49 },
    { key: "enmeshment", title: "Enmeshment", start: 50, end: 56 },
    { key: "subjugation", title: "Subjugation", start: 57, end: 61 },
    { key: "self_sacrifice", title: "Self-Sacrifice", start: 62, end: 67 },
    { key: "fear_of_losing_control", title: "Fear of Losing Control", start: 68, end: 71 },
    { key: "emotional_constriction", title: "Emotional Constriction", start: 72, end: 76 },
    { key: "unrelenting_standards", title: "Unrelenting Standards", start: 77, end: 83 },
    { key: "entitlement", title: "Entitlement", start: 84, end: 89 },
    { key: "insufficient_self_control", title: "Insufficient Self-Control", start: 90, end: 96 },
    { key: "approval_seeking", title: "Approval-Seeking", start: 97, end: 101 },
    { key: "negativity", title: "Negativity", start: 102, end: 107 },
    { key: "punitiveness_self", title: "Punitiveness (Self)", start: 108, end: 112 },
    { key: "punitiveness_other", title: "Punitiveness (Other)", start: 113, end: 116 }
];
const YSQ_ITEMS = YSQ_ITEM_TEXTS.map((prompt, index) => item(`ysq_${index + 1}`, prompt, YSQ_OPTIONS));
function rangeIds(prefix, start, end) {
    const result = [];
    for (let value = start; value <= end; value += 1) {
        result.push(`${prefix}_${value}`);
    }
    return result;
}
function scoreBands(...bands) {
    return bands.map(([label, min, max, severity]) => ({
        label,
        min: typeof min === "number" ? min : null,
        max: typeof max === "number" ? max : null,
        severity: severity ?? ""
    }));
}
const QUESTIONNAIRE_SEEDS = [
    {
        key: "phq_9",
        slug: "phq-9",
        title: "PHQ-9",
        subtitle: "Patient Health Questionnaire",
        description: "Nine-item self-report depression screener covering the past two weeks.",
        aliases: ["Patient Health Questionnaire-9"],
        symptomDomains: ["depression", "mood"],
        tags: ["core", "depression", "self-report"],
        sourceClass: "free_use",
        availability: "open",
        isSelfReport: true,
        definition: buildDefinition({
            presentationMode: "single_question",
            responseStyle: "four_point_frequency",
            instructions: "Over the last 2 weeks, how often have you been bothered by any of the following problems?",
            completionNote: "Higher scores indicate greater depressive symptom burden over the last two weeks.",
            items: PHQ_ITEMS,
            sections: [
                {
                    id: "phq_section",
                    title: "PHQ-9",
                    itemIds: PHQ_ITEMS.map((entry) => entry.id)
                }
            ]
        }),
        scoring: {
            scores: [
                numericScore("phq9_total", "PHQ-9 total", { kind: "sum", itemIds: PHQ_ITEMS.map((entry) => entry.id) }, {
                    dependsOnItemIds: PHQ_ITEMS.map((entry) => entry.id),
                    bands: scoreBands(["Minimal", 0, 4], ["Mild", 5, 9], ["Moderate", 10, 14], ["Moderately severe", 15, 19], ["Severe", 20, 27])
                }),
                numericScore("phq9_item9", "Item 9", { kind: "answer", itemId: "phq_9" }, {
                    dependsOnItemIds: ["phq_9"]
                })
            ]
        },
        provenance: buildProvenance({
            sourceClass: "free_use",
            scoringNotes: "Sum items 1 through 9. Standard total bands are stored on the total score.",
            sources: [
                {
                    label: "PHQ Screeners",
                    url: "https://www.phqscreeners.com/images/sites/g/files/g10060481/f/201412/PHQ-9_English.pdf",
                    citation: "Spitzer RL, Williams JBW, Kroenke K, et al. Patient Health Questionnaire-9 (PHQ-9), English form.",
                    notes: "Official downloadable PDF notes that reproduction and distribution do not require permission."
                }
            ]
        })
    },
    {
        key: "gad_7",
        slug: "gad-7",
        title: "GAD-7",
        subtitle: "Generalized Anxiety Disorder",
        description: "Seven-item self-report anxiety screener covering the past two weeks.",
        aliases: ["Generalized Anxiety Disorder-7"],
        symptomDomains: ["anxiety"],
        tags: ["core", "anxiety", "self-report"],
        sourceClass: "free_use",
        availability: "open",
        isSelfReport: true,
        definition: buildDefinition({
            presentationMode: "single_question",
            responseStyle: "four_point_frequency",
            instructions: "Over the last 2 weeks, how often have you been bothered by the following problems?",
            completionNote: "Higher scores indicate greater anxiety symptom burden over the last two weeks.",
            items: GAD_ITEMS,
            sections: [
                {
                    id: "gad_section",
                    title: "GAD-7",
                    itemIds: GAD_ITEMS.map((entry) => entry.id)
                }
            ]
        }),
        scoring: {
            scores: [
                numericScore("gad7_total", "GAD-7 total", { kind: "sum", itemIds: GAD_ITEMS.map((entry) => entry.id) }, {
                    dependsOnItemIds: GAD_ITEMS.map((entry) => entry.id),
                    bands: scoreBands(["Minimal", 0, 4], ["Mild", 5, 9], ["Moderate", 10, 14], ["Severe", 15, 21])
                })
            ]
        },
        provenance: buildProvenance({
            sourceClass: "free_use",
            scoringNotes: "Sum items 1 through 7. Standard total bands are stored on the total score.",
            sources: [
                {
                    label: "PHQ Screeners",
                    url: "https://www.phqscreeners.com/images/sites/g/files/g10060481/f/201412/GAD-7_English.pdf",
                    citation: "Spitzer RL, Williams JBW, Kroenke K, et al. Generalized Anxiety Disorder-7 (GAD-7), English form.",
                    notes: "Official downloadable PDF notes that reproduction and distribution do not require permission."
                }
            ]
        })
    },
    {
        key: "who_5",
        slug: "who-5",
        title: "WHO-5",
        subtitle: "Well-Being Index",
        description: "Five-item self-report well-being index covering the past two weeks.",
        aliases: ["WHO-5 Well-Being Index"],
        symptomDomains: ["well-being", "mood"],
        tags: ["well-being", "self-report"],
        sourceClass: "open_noncommercial",
        availability: "open",
        isSelfReport: true,
        definition: buildDefinition({
            presentationMode: "single_question",
            responseStyle: "six_point_frequency",
            instructions: "Please indicate for each statement which is closest to how you have been feeling over the last two weeks.",
            completionNote: "Higher scores indicate better mental well-being. The percentage score is the raw score multiplied by four.",
            items: WHO5_ITEMS,
            sections: [
                {
                    id: "who5_section",
                    title: "WHO-5",
                    itemIds: WHO5_ITEMS.map((entry) => entry.id)
                }
            ]
        }),
        scoring: {
            scores: [
                numericScore("who5_raw", "WHO-5 raw score", { kind: "sum", itemIds: WHO5_ITEMS.map((entry) => entry.id) }, {
                    dependsOnItemIds: WHO5_ITEMS.map((entry) => entry.id),
                    bands: scoreBands(["Very low well-being", 0, 7], ["Poor well-being", 8, 12], ["Positive well-being", 13, 25])
                }),
                numericScore("who5_percent", "WHO-5 percentage score", {
                    kind: "multiply",
                    values: [
                        { kind: "score", scoreKey: "who5_raw" },
                        { kind: "const", value: 4 }
                    ]
                }, {
                    valueType: "percent",
                    roundTo: 0
                })
            ]
        },
        provenance: buildProvenance({
            sourceClass: "open_noncommercial",
            scoringNotes: "Raw score is the sum of the five items from 0 to 25. Percentage score is raw multiplied by four. Raw scores below 13 indicate poor mental well-being.",
            sources: [
                {
                    label: "World Health Organization",
                    url: "https://www.who.int/publications/m/item/WHO-UCN-MSD-MHE-2024.01",
                    citation: "World Health Organization. The World Health Organization-Five Well-Being Index (WHO-5). Geneva: WHO; 2024.",
                    notes: "WHO republishes the tool as open access under CC BY-NC-SA 3.0 IGO."
                },
                {
                    label: "WHO-5 English PDF",
                    url: "https://cdn.who.int/media/docs/default-source/mental-health/who-5_english-original4da539d6ed4b49389e3afe47cda2326a.pdf?download=true&sfvrsn=ed43f352_11",
                    citation: "World Health Organization. WHO-5 English original form, 2024.",
                    notes: "Question text and scoring details verified from the WHO-hosted PDF."
                }
            ]
        })
    },
    {
        key: "pcl_5",
        slug: "pcl-5",
        title: "PCL-5",
        subtitle: "PTSD Checklist for DSM-5",
        description: "Twenty-item self-report PTSD symptom checklist covering the past month.",
        aliases: ["PTSD Checklist for DSM-5"],
        symptomDomains: ["trauma", "ptsd"],
        tags: ["trauma", "self-report", "ptsd"],
        sourceClass: "public_domain",
        availability: "open",
        isSelfReport: true,
        definition: buildDefinition({
            presentationMode: "single_question",
            responseStyle: "five_point_severity",
            instructions: "Keeping your worst event in mind, please read each problem carefully and indicate how much you have been bothered by that problem in the past month.",
            completionNote: "The total is the sum of all 20 items. Cluster subscores are stored for intrusion, avoidance, negative alterations, and arousal/reactivity.",
            items: PCL_ITEMS,
            sections: [
                {
                    id: "intrusion",
                    title: "Intrusion",
                    itemIds: rangeIds("pcl", 1, 5)
                },
                {
                    id: "avoidance",
                    title: "Avoidance",
                    itemIds: rangeIds("pcl", 6, 7)
                },
                {
                    id: "negative_alterations",
                    title: "Negative alterations in cognition and mood",
                    itemIds: rangeIds("pcl", 8, 14)
                },
                {
                    id: "arousal",
                    title: "Arousal and reactivity",
                    itemIds: rangeIds("pcl", 15, 20)
                }
            ]
        }),
        scoring: {
            scores: [
                numericScore("pcl5_total", "PCL-5 total", { kind: "sum", itemIds: PCL_ITEMS.map((entry) => entry.id) }, {
                    dependsOnItemIds: PCL_ITEMS.map((entry) => entry.id),
                    bands: scoreBands(["Below typical provisional threshold", 0, 30], ["At threshold range", 31, 32], ["Above threshold range", 33, 80])
                }),
                numericScore("pcl5_intrusion", "Intrusion", { kind: "sum", itemIds: rangeIds("pcl", 1, 5) }, {
                    dependsOnItemIds: rangeIds("pcl", 1, 5)
                }),
                numericScore("pcl5_avoidance", "Avoidance", { kind: "sum", itemIds: rangeIds("pcl", 6, 7) }, {
                    dependsOnItemIds: rangeIds("pcl", 6, 7)
                }),
                numericScore("pcl5_negative_alterations", "Negative alterations", { kind: "sum", itemIds: rangeIds("pcl", 8, 14) }, {
                    dependsOnItemIds: rangeIds("pcl", 8, 14)
                }),
                numericScore("pcl5_arousal", "Arousal/reactivity", { kind: "sum", itemIds: rangeIds("pcl", 15, 20) }, {
                    dependsOnItemIds: rangeIds("pcl", 15, 20)
                })
            ]
        },
        provenance: buildProvenance({
            sourceClass: "public_domain",
            scoringNotes: "Total score is the sum of the 20 items. Cluster subscores follow the DSM-5 symptom clusters. The National Center for PTSD describes the instrument as public domain.",
            sources: [
                {
                    label: "National Center for PTSD",
                    url: "https://www.ptsd.va.gov/professional/assessment/adult-sr/ptsd-checklist.asp",
                    citation: "National Center for PTSD. PTSD Checklist for DSM-5 (PCL-5), accessed 2026-04-06.",
                    notes: "Official overview page states the measure is public domain."
                },
                {
                    label: "PCL-5 Standard form PDF",
                    url: "https://www.ptsd.va.gov/PTSD/professional/assessment/documents/PCL5_Standard_form.pdf",
                    citation: "Weathers FW, Litz BT, Keane TM, Palmieri PA, Marx BP, Schnurr PP. PTSD Checklist for DSM-5 (PCL-5), standard form.",
                    notes: "Question text verified against the official PDF."
                }
            ]
        })
    },
    {
        key: "audit",
        slug: "audit",
        title: "AUDIT",
        subtitle: "Alcohol Use Disorders Identification Test",
        description: "Ten-item self-report alcohol screening questionnaire.",
        aliases: ["Alcohol Use Disorders Identification Test"],
        symptomDomains: ["substance use", "alcohol"],
        tags: ["alcohol", "self-report"],
        sourceClass: "open_noncommercial",
        availability: "open",
        isSelfReport: true,
        definition: buildDefinition({
            presentationMode: "single_question",
            responseStyle: "mixed_frequency_quantity",
            instructions: "These questions refer to alcohol use. Select the option that best matches your experience.",
            completionNote: "The total is the sum of all ten items, with items 9 and 10 scored 0, 2, or 4.",
            items: AUDIT_ITEMS,
            sections: [
                {
                    id: "audit_section",
                    title: "AUDIT",
                    itemIds: AUDIT_ITEMS.map((entry) => entry.id)
                }
            ]
        }),
        scoring: {
            scores: [
                numericScore("audit_total", "AUDIT total", { kind: "sum", itemIds: AUDIT_ITEMS.map((entry) => entry.id) }, {
                    dependsOnItemIds: AUDIT_ITEMS.map((entry) => entry.id),
                    bands: scoreBands(["Zone I · Low risk", 0, 7], ["Zone II · Hazardous", 8, 15], ["Zone III · Harmful", 16, 19], ["Zone IV · Possible dependence", 20, 40])
                })
            ]
        },
        provenance: buildProvenance({
            sourceClass: "open_noncommercial",
            scoringNotes: "Items 1 through 8 are scored 0 to 4. Items 9 and 10 are scored 0, 2, or 4. Total zones follow the WHO manual.",
            sources: [
                {
                    label: "World Health Organization publication page",
                    url: "https://www.who.int/publications/i/item/WHO-MSD-MSB-01.6a",
                    citation: "Babor TF, Higgins-Biddle JC, Saunders JB, Monteiro MG. AUDIT: The Alcohol Use Disorders Identification Test. WHO; 2001.",
                    notes: "WHO publication page for the manual and self-report questionnaire appendix."
                },
                {
                    label: "WHO AUDIT manual PDF",
                    url: "https://iris.who.int/server/api/core/bitstreams/c57d9855-5450-4c46-84b1-c88a6df4192c/content",
                    citation: "World Health Organization. AUDIT manual and self-report questionnaire appendix.",
                    notes: "WHO manual permits free review, reproduction, and translation for non-commercial use."
                }
            ]
        })
    },
    {
        key: "srq_20",
        slug: "srq-20",
        title: "SRQ-20",
        subtitle: "Self-Reporting Questionnaire",
        description: "Twenty-item self-report screening questionnaire for common mental health symptoms.",
        aliases: ["Self Reporting Questionnaire-20", "WHO SRQ-20"],
        symptomDomains: ["common mental disorders", "distress"],
        tags: ["screening", "self-report", "who"],
        sourceClass: "secondary_verified",
        availability: "open",
        isSelfReport: true,
        definition: buildDefinition({
            presentationMode: "single_question",
            responseStyle: "yes_no",
            instructions: "Answer yes or no for each symptom based on your recent experience.",
            completionNote: "The SRQ-20 total is the count of “Yes” responses. Cutoffs vary by study context, so the raw total is stored directly.",
            items: SRQ_ITEMS,
            sections: [
                {
                    id: "srq_section",
                    title: "SRQ-20",
                    itemIds: SRQ_ITEMS.map((entry) => entry.id)
                }
            ]
        }),
        scoring: {
            scores: [
                numericScore("srq20_total", "SRQ-20 total", { kind: "sum", itemIds: SRQ_ITEMS.map((entry) => entry.id) }, {
                    dependsOnItemIds: SRQ_ITEMS.map((entry) => entry.id),
                    bands: scoreBands(["Lower symptom count", 0, 7], ["Elevated symptom count", 8, 20])
                })
            ]
        },
        provenance: buildProvenance({
            sourceClass: "secondary_verified",
            scoringNotes: "Total score is the count of yes responses across the 20 items. The item wording was verified against accessible secondary tables because the WHO archival PDF is OCR-poor in this environment.",
            sources: [
                {
                    label: "WHO IRIS archival record",
                    url: "https://iris.who.int/handle/10665/61113",
                    citation: "World Health Organization. A user's guide to the Self Reporting Questionnaire (SRQ). Geneva: WHO; 1994.",
                    notes: "Archival WHO source used for provenance and scoring intent."
                },
                {
                    label: "MHPSS Knowledge Hub",
                    url: "https://mhpssknowledgehub.sph.cuny.edu/measures/self-reporting-questionnaire-srq/",
                    citation: "MHPSS Knowledge Hub. Self-Reporting Questionnaire (SRQ) measure summary.",
                    notes: "Accessible secondary reference confirming SRQ-20 format and public availability."
                }
            ]
        })
    },
    {
        key: "ysq_r",
        slug: "ysq-r",
        title: "YSQ-R",
        subtitle: "Young Schema Questionnaire Revised",
        description: "Long-form schema questionnaire with schema-level mean and elevation scoring.",
        aliases: ["Young Schema Questionnaire - Revised"],
        symptomDomains: ["schemas", "personality patterns"],
        tags: ["schema therapy", "self-report", "clinician"],
        sourceClass: "free_clinician",
        availability: "free_clinician",
        isSelfReport: true,
        definition: buildDefinition({
            presentationMode: "batched_likert",
            responseStyle: "six_point_schema_rating",
            instructions: "Listed below are statements that someone might use to describe themselves. Decide how well each statement describes you and choose the highest rating from 1 to 6.",
            completionNote: "Each schema stores a mean score, the proportion of 5 and 6 responses, the proportion of 4, 5, and 6 responses, and an elevation label that matches the distributed scorer workbook.",
            items: YSQ_ITEMS,
            sections: YSQ_SCHEMA_GROUPS.map((group) => ({
                id: group.key,
                title: group.title,
                itemIds: rangeIds("ysq", group.start, group.end)
            })),
            pageSize: 8
        }),
        scoring: {
            scores: YSQ_SCHEMA_GROUPS.flatMap((group) => {
                const itemIds = rangeIds("ysq", group.start, group.end);
                return [
                    numericScore(`${group.key}_mean`, `${group.title} mean`, { kind: "average", itemIds }, {
                        dependsOnItemIds: itemIds,
                        missingPolicy: { mode: "allow_partial" },
                        roundTo: 2
                    }),
                    numericScore(`${group.key}_pct_56`, `${group.title} % of 5s and 6s`, {
                        kind: "round",
                        digits: 4,
                        value: {
                            kind: "divide",
                            left: {
                                kind: "count_if",
                                itemIds,
                                comparator: "gt",
                                target: 4
                            },
                            right: {
                                kind: "const",
                                value: itemIds.length
                            },
                            zeroValue: 0
                        }
                    }, {
                        dependsOnItemIds: itemIds,
                        missingPolicy: { mode: "allow_partial" },
                        valueType: "percent"
                    }),
                    numericScore(`${group.key}_pct_456`, `${group.title} % of 4s, 5s and 6s`, {
                        kind: "round",
                        digits: 4,
                        value: {
                            kind: "divide",
                            left: {
                                kind: "count_if",
                                itemIds,
                                comparator: "gt",
                                target: 3
                            },
                            right: {
                                kind: "const",
                                value: itemIds.length
                            },
                            zeroValue: 0
                        }
                    }, {
                        dependsOnItemIds: itemIds,
                        missingPolicy: { mode: "allow_partial" },
                        valueType: "percent"
                    }),
                    {
                        key: `${group.key}_elevation`,
                        label: `${group.title} elevation`,
                        description: "",
                        valueType: "text",
                        expression: {
                            kind: "if",
                            condition: {
                                kind: "compare",
                                comparator: "gte",
                                left: { kind: "score", scoreKey: `${group.key}_mean` },
                                right: { kind: "const", value: 4 }
                            },
                            then: { kind: "const", value: "Elevated" },
                            else: {
                                kind: "if",
                                condition: {
                                    kind: "compare",
                                    comparator: "gte",
                                    left: { kind: "score", scoreKey: `${group.key}_pct_56` },
                                    right: { kind: "const", value: 0.5 }
                                },
                                then: { kind: "const", value: "Elevated" },
                                else: { kind: "const", value: "Not Elevated" }
                            }
                        },
                        dependsOnItemIds: [],
                        missingPolicy: { mode: "allow_partial" },
                        bands: [],
                        roundTo: null,
                        unitLabel: ""
                    }
                ];
            })
        },
        provenance: buildProvenance({
            sourceClass: "free_clinician",
            scoringNotes: "Schema means and elevation logic mirror the downloadable YSQ-R scorer workbook. The resource is free for research and trained-clinician assessment use but is not openly licensed.",
            sources: [
                {
                    label: "Anima Schema Therapy resources",
                    url: "https://www.anima.com.au/schema",
                    citation: "Anima. YSQ-R clinician resource hub, accessed 2026-04-06.",
                    notes: "Public page linking the questionnaire workbook, scorer workbook, and instructions."
                },
                {
                    label: "YSQ-R questionnaire workbook",
                    url: "https://www.anima.com.au/s/YSQ-R-Questionniare-V-452-23122025-Finalpro.xlsx",
                    citation: "Yalcin O, Marais I, Lee C, Correia H. YSQ-R questionnaire workbook, version 4.5.",
                    notes: "Item wording transcribed from the downloadable workbook."
                },
                {
                    label: "YSQ-R scorer workbook",
                    url: "https://www.anima.com.au/s/YSQ-R-Scorer-Version-452-Finalpro-231225.xlsx",
                    citation: "Yalcin O. YSQ-R scorer workbook, version 4.52.",
                    notes: "Schema mean, percentage, and elevation formulae mirrored from the scorer workbook."
                }
            ]
        })
    }
];
export function getQuestionnaireSeeds() {
    return QUESTIONNAIRE_SEEDS;
}
