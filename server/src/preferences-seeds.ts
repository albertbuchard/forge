import type {
  PreferenceDimensionVector,
  PreferenceDomain
} from "./preferences-types.js";

export type PreferenceCatalogSeedItem = {
  label: string;
  description: string;
  tags: string[];
  featureWeights: PreferenceDimensionVector;
};

export type PreferenceCatalogSeed = {
  slug: string;
  title: string;
  description: string;
  items: PreferenceCatalogSeedItem[];
};

const ZERO_VECTOR: PreferenceDimensionVector = {
  novelty: 0,
  simplicity: 0,
  rigor: 0,
  aesthetics: 0,
  depth: 0,
  structure: 0,
  familiarity: 0,
  surprise: 0
};

function weights(
  patch: Partial<PreferenceDimensionVector>
): PreferenceDimensionVector {
  return {
    ...ZERO_VECTOR,
    ...patch
  };
}

function item(
  label: string,
  description: string,
  tags: string[],
  featureWeights: Partial<PreferenceDimensionVector>
): PreferenceCatalogSeedItem {
  return {
    label,
    description,
    tags,
    featureWeights: weights(featureWeights)
  };
}

const PREFERENCE_CATALOG_SEEDS: Partial<
  Record<PreferenceDomain, PreferenceCatalogSeed[]>
> = {
  food: [
    {
      slug: "cuisine-styles",
      title: "Cuisine styles",
      description: "Broad cuisine directions for fast food preference rounds.",
      items: [
        item("Japanese", "Clean lines, precision, and layered subtlety.", ["cuisine", "food"], { rigor: 0.55, aesthetics: 0.45, simplicity: 0.18 }),
        item("Italian", "Comfort, familiarity, and generous shared plates.", ["cuisine", "comfort"], { familiarity: 0.48, aesthetics: 0.14, depth: 0.18 }),
        item("Mexican", "Bold flavor, contrast, and high sensory reward.", ["cuisine", "spice"], { surprise: 0.35, novelty: 0.24, aesthetics: 0.08 }),
        item("Thai", "Aromatic balance with bright, fast-moving flavors.", ["cuisine", "aromatic"], { novelty: 0.32, surprise: 0.28, depth: 0.22 }),
        item("French", "Technique, polish, and ritualized dining.", ["cuisine", "classic"], { rigor: 0.58, aesthetics: 0.4, familiarity: 0.1 }),
        item("Indian", "Spice complexity, warmth, and layered depth.", ["cuisine", "depth"], { depth: 0.52, surprise: 0.26, novelty: 0.2 }),
        item("Mediterranean", "Freshness, balance, and easy repeatability.", ["cuisine", "fresh"], { simplicity: 0.34, familiarity: 0.32, aesthetics: 0.18 }),
        item("Korean", "Fermented punch, heat, and high-energy contrast.", ["cuisine", "fermented"], { surprise: 0.42, novelty: 0.3, depth: 0.22 })
      ]
    },
    {
      slug: "meal-moods",
      title: "Meal moods",
      description: "The shape of meal experiences rather than cuisines alone.",
      items: [
        item("Slow tasting menu", "Measured courses and deliberate pacing.", ["meal", "ritual"], { rigor: 0.5, depth: 0.44, structure: 0.28 }),
        item("Street food run", "Immediate, casual, high-flavor decisions.", ["meal", "casual"], { simplicity: 0.38, surprise: 0.24, novelty: 0.18 }),
        item("Family-style spread", "Shared plates and social abundance.", ["meal", "social"], { familiarity: 0.38, depth: 0.1, aesthetics: 0.05 }),
        item("Minimal healthy bowl", "Clean ingredients and low-friction nutrition.", ["meal", "health"], { simplicity: 0.52, structure: 0.25, familiarity: 0.12 }),
        item("Dessert-first stop", "Sugar-forward reward and pleasure seeking.", ["meal", "sweet"], { surprise: 0.22, aesthetics: 0.18, novelty: 0.08 }),
        item("Late-night comfort order", "Warm, heavy, and emotionally settling.", ["meal", "comfort"], { familiarity: 0.56, simplicity: 0.18, structure: -0.08 }),
        item("Brunch cafe", "Relaxed social meal with some indulgence.", ["meal", "social"], { familiarity: 0.28, aesthetics: 0.24, simplicity: 0.1 }),
        item("High-protein prep meal", "Purposeful, repeatable, and utility-first.", ["meal", "utility"], { structure: 0.44, rigor: 0.24, aesthetics: -0.08 })
      ]
    },
    {
      slug: "drink-profiles",
      title: "Drink profiles",
      description: "Starter drink preferences across everyday and social contexts.",
      items: [
        item("Espresso", "Short, strong, focused energy.", ["drink", "coffee"], { rigor: 0.26, depth: 0.22, simplicity: 0.2 }),
        item("Flat white", "Balanced comfort and smooth routine.", ["drink", "coffee"], { familiarity: 0.34, simplicity: 0.12, aesthetics: 0.08 }),
        item("Matcha", "Calm ritual with distinctive vegetal taste.", ["drink", "tea"], { rigor: 0.18, novelty: 0.18, aesthetics: 0.18 }),
        item("Sparkling water", "Neutral refreshment and low-noise choice.", ["drink", "simple"], { simplicity: 0.5, structure: 0.18, surprise: -0.06 }),
        item("Red wine", "Depth, warmth, and social evening texture.", ["drink", "social"], { depth: 0.34, familiarity: 0.18, aesthetics: 0.12 }),
        item("Craft cocktail", "Expressive flavor and deliberate novelty.", ["drink", "cocktail"], { novelty: 0.3, aesthetics: 0.24, surprise: 0.26 }),
        item("Fresh juice", "Bright, easy, and immediate sensory clarity.", ["drink", "fresh"], { simplicity: 0.28, aesthetics: 0.18, familiarity: 0.08 }),
        item("Cold brew", "Longer, smoother caffeine with modern feel.", ["drink", "coffee"], { depth: 0.16, novelty: 0.12, structure: 0.12 })
      ]
    }
  ],
  activities: [
    {
      slug: "movement-styles",
      title: "Movement styles",
      description: "Starter activity set spanning solo, social, calm, and intense movement.",
      items: [
        item("Long hike", "Steady movement with landscape and time to think.", ["activity", "outdoors"], { depth: 0.3, familiarity: 0.16, structure: 0.1 }),
        item("Heavy lifting", "Controlled intensity and strength progression.", ["activity", "training"], { rigor: 0.48, structure: 0.3, novelty: -0.06 }),
        item("Dance night", "Expressive social movement and rhythm.", ["activity", "social"], { aesthetics: 0.34, surprise: 0.18, novelty: 0.18 }),
        item("Swimming laps", "Quiet, repetitive, body-wide exertion.", ["activity", "solo"], { structure: 0.34, simplicity: 0.18, depth: 0.12 }),
        item("Climbing gym", "Problem solving with physical variety.", ["activity", "problem-solving"], { novelty: 0.28, rigor: 0.18, surprise: 0.16 }),
        item("Yoga flow", "Mobility, breath, and grounded awareness.", ["activity", "recovery"], { simplicity: 0.18, depth: 0.28, aesthetics: 0.16 }),
        item("Team sport", "Competitive rhythm and shared momentum.", ["activity", "competitive"], { surprise: 0.18, familiarity: 0.08, structure: 0.12 }),
        item("Easy walk", "Low-friction movement that fits almost any day.", ["activity", "light"], { simplicity: 0.46, familiarity: 0.28, rigor: -0.08 })
      ]
    },
    {
      slug: "leisure-shapes",
      title: "Leisure shapes",
      description: "How someone likes to spend unstructured or semi-structured free time.",
      items: [
        item("Museum afternoon", "Slow visual attention and curated discovery.", ["leisure", "culture"], { aesthetics: 0.42, depth: 0.28, novelty: 0.16 }),
        item("Board game night", "Social strategy with repeatable structure.", ["leisure", "social"], { structure: 0.34, familiarity: 0.16, rigor: 0.14 }),
        item("Beach day", "Low-pressure pleasure and sensory ease.", ["leisure", "outdoors"], { simplicity: 0.28, familiarity: 0.18, aesthetics: 0.12 }),
        item("Live concert", "High-energy shared atmosphere and intensity.", ["leisure", "music"], { surprise: 0.24, novelty: 0.2, aesthetics: 0.18 }),
        item("Reading retreat", "Quiet immersion and strong internal focus.", ["leisure", "solo"], { depth: 0.46, rigor: 0.12, structure: 0.18 }),
        item("Cooking with friends", "Shared making and practical intimacy.", ["leisure", "social"], { familiarity: 0.28, aesthetics: 0.12, depth: 0.06 }),
        item("Photography walk", "Exploration with a frame and a lens.", ["leisure", "creative"], { aesthetics: 0.36, novelty: 0.16, structure: 0.08 }),
        item("Arcade session", "Fast reward, noise, and playful competition.", ["leisure", "play"], { surprise: 0.24, familiarity: 0.06, novelty: 0.12 })
      ]
    },
    {
      slug: "social-settings",
      title: "Social settings",
      description: "Starter comparisons for preferred social environments.",
      items: [
        item("Small dinner", "Few people, longer depth, real conversation.", ["social", "intimate"], { depth: 0.38, familiarity: 0.22, structure: 0.08 }),
        item("Big house party", "Movement, noise, and many weak ties.", ["social", "high-energy"], { novelty: 0.22, surprise: 0.24, structure: -0.1 }),
        item("Coffee with one person", "Simple, direct, and low-friction contact.", ["social", "one-to-one"], { simplicity: 0.38, familiarity: 0.18, depth: 0.16 }),
        item("Creative workshop", "Meeting people through shared making.", ["social", "creative"], { novelty: 0.2, rigor: 0.08, aesthetics: 0.14 }),
        item("Quiet shared walk", "Parallel presence without constant talking.", ["social", "calm"], { simplicity: 0.24, depth: 0.18, familiarity: 0.12 }),
        item("Networking event", "Instrumental contact and quick positioning.", ["social", "professional"], { structure: 0.28, rigor: 0.1, familiarity: -0.08 }),
        item("Game cafe", "Playful structure and easy social prompts.", ["social", "play"], { structure: 0.18, familiarity: 0.14, surprise: 0.06 }),
        item("Festival crowd", "Large-scale atmosphere and sensory overload.", ["social", "festival"], { novelty: 0.24, surprise: 0.32, aesthetics: 0.12 })
      ]
    }
  ],
  places: [
    {
      slug: "living-environments",
      title: "Living environments",
      description: "What kinds of places feel right to inhabit day after day.",
      items: [
        item("Dense city center", "Constant access, movement, and friction.", ["place", "city"], { novelty: 0.2, surprise: 0.18, familiarity: -0.08 }),
        item("Quiet suburb", "Predictable comfort and everyday ease.", ["place", "suburb"], { familiarity: 0.42, simplicity: 0.18, surprise: -0.12 }),
        item("Mountain town", "Nature-first calm with smaller rhythms.", ["place", "nature"], { depth: 0.18, familiarity: 0.12, aesthetics: 0.2 }),
        item("Coastal city", "Urban access with water and openness.", ["place", "coast"], { aesthetics: 0.28, novelty: 0.08, familiarity: 0.1 }),
        item("Countryside village", "Low-speed routine and tangible local texture.", ["place", "rural"], { familiarity: 0.36, simplicity: 0.18, structure: 0.06 }),
        item("Creative district", "Visual density, culture, and chance encounters.", ["place", "creative"], { aesthetics: 0.34, novelty: 0.2, surprise: 0.12 }),
        item("University area", "Youthful energy and idea-heavy atmosphere.", ["place", "study"], { rigor: 0.18, novelty: 0.16, structure: 0.08 }),
        item("Remote retreat", "Distance, silence, and deliberate disconnection.", ["place", "retreat"], { depth: 0.34, structure: 0.12, familiarity: 0.08 })
      ]
    },
    {
      slug: "venue-moods",
      title: "Venue moods",
      description: "How a physical venue should feel during work, leisure, or dates.",
      items: [
        item("Minimal quiet cafe", "Airy, calm, and low clutter.", ["venue", "quiet"], { simplicity: 0.4, aesthetics: 0.16, rigor: 0.08 }),
        item("Warm candle bar", "Dark, intimate, and emotionally textured.", ["venue", "date"], { aesthetics: 0.3, depth: 0.2, familiarity: 0.08 }),
        item("Rooftop terrace", "Open skyline, movement, and social energy.", ["venue", "open"], { novelty: 0.18, surprise: 0.14, aesthetics: 0.28 }),
        item("Traditional brasserie", "Classic, grounded, and legible ritual.", ["venue", "classic"], { familiarity: 0.26, rigor: 0.14, aesthetics: 0.12 }),
        item("Industrial warehouse space", "Raw, large, and slightly rough.", ["venue", "industrial"], { novelty: 0.2, surprise: 0.1, aesthetics: 0.08 }),
        item("Garden patio", "Soft natural texture and lighter pace.", ["venue", "garden"], { aesthetics: 0.26, familiarity: 0.16, simplicity: 0.1 }),
        item("Library reading room", "Silence, focus, and institutional calm.", ["venue", "focus"], { rigor: 0.34, structure: 0.2, simplicity: 0.08 }),
        item("Crowded market hall", "Noise, texture, and many micro-decisions.", ["venue", "busy"], { surprise: 0.22, novelty: 0.18, familiarity: -0.06 })
      ]
    },
    {
      slug: "trip-shapes",
      title: "Trip shapes",
      description: "Starter trip archetypes for travel preference rounds.",
      items: [
        item("Museum city break", "Culture-heavy urban weekend.", ["travel", "culture"], { rigor: 0.22, aesthetics: 0.26, depth: 0.12 }),
        item("Food-first trip", "Travel organized around meals and local taste.", ["travel", "food"], { surprise: 0.18, novelty: 0.12, familiarity: 0.04 }),
        item("Remote cabin", "Disconnection, nature, and long quiet hours.", ["travel", "retreat"], { depth: 0.36, familiarity: 0.1, simplicity: 0.12 }),
        item("Beach resort", "Ease, recovery, and low-decision days.", ["travel", "rest"], { simplicity: 0.3, familiarity: 0.16, surprise: -0.08 }),
        item("Backpacking circuit", "Unscripted novelty and flexible movement.", ["travel", "adventure"], { novelty: 0.42, surprise: 0.3, structure: -0.14 }),
        item("Road trip", "Movement, variety, and companion rhythm.", ["travel", "road"], { novelty: 0.2, familiarity: 0.08, surprise: 0.14 }),
        item("Wellness spa stay", "Recovery, body care, and low urgency.", ["travel", "recovery"], { simplicity: 0.18, depth: 0.14, aesthetics: 0.16 }),
        item("Mountain ski week", "Cold air, exertion, and alpine routine.", ["travel", "winter"], { rigor: 0.16, familiarity: 0.04, surprise: 0.08 })
      ]
    }
  ],
  countries: [
    {
      slug: "countries-to-visit",
      title: "Countries to visit",
      description: "Starter list of countries for broad travel taste calibration.",
      items: [
        item("Japan", "Precision, design, and layered urban-calm contrast.", ["country", "travel"], { rigor: 0.32, aesthetics: 0.28, novelty: 0.18 }),
        item("Italy", "Beauty, food, and familiar sensuality.", ["country", "travel"], { familiarity: 0.28, aesthetics: 0.28, depth: 0.08 }),
        item("France", "Culture, polish, and intellectual density.", ["country", "travel"], { rigor: 0.26, aesthetics: 0.28, depth: 0.12 }),
        item("Portugal", "Light, coast, and slower social warmth.", ["country", "travel"], { simplicity: 0.18, familiarity: 0.16, aesthetics: 0.2 }),
        item("Switzerland", "Order, landscape, and controlled calm.", ["country", "travel"], { rigor: 0.28, structure: 0.18, familiarity: 0.1 }),
        item("Mexico", "Color, flavor, and vivid public life.", ["country", "travel"], { novelty: 0.18, surprise: 0.2, aesthetics: 0.1 }),
        item("South Korea", "Intensity, polish, and fast-moving modernity.", ["country", "travel"], { novelty: 0.24, rigor: 0.14, surprise: 0.16 }),
        item("Iceland", "Extreme landscape and elemental quiet.", ["country", "travel"], { depth: 0.18, novelty: 0.24, aesthetics: 0.2 }),
        item("Brazil", "Scale, rhythm, and social energy.", ["country", "travel"], { surprise: 0.24, novelty: 0.2, familiarity: -0.02 }),
        item("New Zealand", "Outdoor beauty and easy breathing room.", ["country", "travel"], { simplicity: 0.1, aesthetics: 0.22, familiarity: 0.08 })
      ]
    },
    {
      slug: "countries-to-live",
      title: "Countries to live",
      description: "Starter list oriented around lifestyle fit rather than tourism only.",
      items: [
        item("Netherlands", "Bikeable structure and modern social order.", ["country", "living"], { structure: 0.24, simplicity: 0.14, familiarity: 0.12 }),
        item("Spain", "Climate, street life, and flexible rhythm.", ["country", "living"], { familiarity: 0.18, surprise: 0.08, aesthetics: 0.18 }),
        item("Germany", "Reliability, systems, and predictable function.", ["country", "living"], { rigor: 0.32, structure: 0.22, novelty: -0.08 }),
        item("Canada", "Space, stability, and broad daily ease.", ["country", "living"], { familiarity: 0.2, simplicity: 0.16, surprise: -0.02 }),
        item("Singapore", "Efficiency, density, and tightly managed order.", ["country", "living"], { rigor: 0.34, structure: 0.28, novelty: 0.08 }),
        item("Australia", "Space, sun, and practical informality.", ["country", "living"], { simplicity: 0.14, familiarity: 0.18, aesthetics: 0.12 }),
        item("Sweden", "Calm systems and restrained design culture.", ["country", "living"], { simplicity: 0.18, rigor: 0.16, aesthetics: 0.18 }),
        item("United States", "Scale, choice, and uneven but large opportunity.", ["country", "living"], { novelty: 0.18, surprise: 0.1, depth: 0.04 })
      ]
    }
  ],
  fashion: [
    {
      slug: "silhouettes",
      title: "Silhouettes",
      description: "Starter clothing silhouettes and styling directions.",
      items: [
        item("Tailored", "Clean lines and structured fit.", ["fashion", "shape"], { rigor: 0.3, structure: 0.3, aesthetics: 0.18 }),
        item("Relaxed oversized", "Volume, ease, and unforced confidence.", ["fashion", "shape"], { simplicity: 0.14, aesthetics: 0.16, familiarity: 0.08 }),
        item("Athletic fitted", "Performance-first body emphasis.", ["fashion", "shape"], { rigor: 0.16, structure: 0.18, surprise: -0.02 }),
        item("Soft draped", "Flowing texture and gentler movement.", ["fashion", "shape"], { aesthetics: 0.24, depth: 0.08, structure: -0.08 }),
        item("Minimal monochrome", "Low-noise uniformity and clarity.", ["fashion", "minimal"], { simplicity: 0.42, rigor: 0.18, aesthetics: 0.14 }),
        item("Eclectic layered", "Contrast, texture, and visible experimentation.", ["fashion", "bold"], { novelty: 0.3, surprise: 0.24, aesthetics: 0.18 }),
        item("Classic elegant", "Timeless pieces and polished proportion.", ["fashion", "classic"], { familiarity: 0.18, rigor: 0.22, aesthetics: 0.26 }),
        item("Streetwear graphic", "Bold statements and youth-coded energy.", ["fashion", "streetwear"], { surprise: 0.24, novelty: 0.2, aesthetics: 0.14 })
      ]
    },
    {
      slug: "materials-and-feel",
      title: "Materials and feel",
      description: "How clothing and accessories should feel on the body and in the eye.",
      items: [
        item("Linen", "Light, breathable, and slightly imperfect.", ["fashion", "material"], { simplicity: 0.18, aesthetics: 0.18, familiarity: 0.08 }),
        item("Leather", "Dense, strong, and assertive.", ["fashion", "material"], { rigor: 0.14, depth: 0.12, aesthetics: 0.16 }),
        item("Cashmere", "Soft luxury and calm warmth.", ["fashion", "material"], { familiarity: 0.12, aesthetics: 0.2, depth: 0.08 }),
        item("Denim", "Durable everyday structure.", ["fashion", "material"], { familiarity: 0.28, structure: 0.1, simplicity: 0.08 }),
        item("Technical fabric", "Performance, utility, and modern function.", ["fashion", "material"], { rigor: 0.22, structure: 0.24, novelty: 0.06 }),
        item("Silk", "Fluid elegance and visual sheen.", ["fashion", "material"], { aesthetics: 0.28, depth: 0.08, surprise: 0.06 }),
        item("Wool", "Substance, warmth, and quiet seriousness.", ["fashion", "material"], { rigor: 0.18, familiarity: 0.18, depth: 0.1 }),
        item("Mesh or sheer", "Light reveal and visual edge.", ["fashion", "material"], { novelty: 0.22, surprise: 0.2, aesthetics: 0.14 })
      ]
    },
    {
      slug: "color-palettes",
      title: "Color palettes",
      description: "Starter palette preferences for personal style.",
      items: [
        item("All black", "Sharp, easy, and visually controlled.", ["fashion", "color"], { simplicity: 0.3, rigor: 0.14, aesthetics: 0.16 }),
        item("Earth tones", "Warm natural grounding without loud contrast.", ["fashion", "color"], { familiarity: 0.18, depth: 0.12, aesthetics: 0.14 }),
        item("Crisp neutrals", "Light, calm, and quietly polished.", ["fashion", "color"], { simplicity: 0.26, aesthetics: 0.18, structure: 0.08 }),
        item("Jewel tones", "Rich saturation and expressive elegance.", ["fashion", "color"], { aesthetics: 0.24, depth: 0.14, surprise: 0.08 }),
        item("Pastels", "Soft approachability and lower visual aggression.", ["fashion", "color"], { simplicity: 0.12, familiarity: 0.1, aesthetics: 0.16 }),
        item("High-contrast brights", "Immediate attention and energy.", ["fashion", "color"], { novelty: 0.22, surprise: 0.22, aesthetics: 0.12 }),
        item("Muted cool tones", "Composure and distance without dullness.", ["fashion", "color"], { rigor: 0.12, depth: 0.12, aesthetics: 0.18 }),
        item("Warm sunset tones", "Playful warmth and social softness.", ["fashion", "color"], { familiarity: 0.12, aesthetics: 0.18, surprise: 0.06 })
      ]
    }
  ],
  people: [
    {
      slug: "body-types",
      title: "Body types",
      description: "Editable starter list for physical attraction or aesthetic preference rounds.",
      items: [
        item("Athletic", "Defined, active, and performance-coded build.", ["people", "body-type"], { rigor: 0.18, structure: 0.12, familiarity: 0.04 }),
        item("Lean", "Light, long, and minimal visual density.", ["people", "body-type"], { simplicity: 0.14, aesthetics: 0.12, familiarity: 0.02 }),
        item("Curvy", "Soft contrast and fuller shape.", ["people", "body-type"], { depth: 0.1, aesthetics: 0.18, familiarity: 0.08 }),
        item("Broad-shouldered", "Presence through frame and width.", ["people", "body-type"], { rigor: 0.08, structure: 0.08, depth: 0.04 }),
        item("Compact", "Smaller scale and tighter physical silhouette.", ["people", "body-type"], { simplicity: 0.12, familiarity: 0.06, surprise: -0.02 }),
        item("Tall and lanky", "Length, ease, and slight asymmetry.", ["people", "body-type"], { novelty: 0.1, aesthetics: 0.14, surprise: 0.04 }),
        item("Soft", "Gentler contours and lower visual hardness.", ["people", "body-type"], { familiarity: 0.12, depth: 0.06, simplicity: 0.02 }),
        item("Sculpted", "High definition and deliberate body care.", ["people", "body-type"], { rigor: 0.14, aesthetics: 0.12, structure: 0.08 })
      ]
    },
    {
      slug: "presence-styles",
      title: "Presence styles",
      description: "How someone's vibe or social gravity tends to read.",
      items: [
        item("Warm and easy", "Inviting, soft, and quickly reassuring.", ["people", "presence"], { familiarity: 0.28, simplicity: 0.12, depth: 0.06 }),
        item("Quiet intense", "Controlled energy with hidden depth.", ["people", "presence"], { depth: 0.28, rigor: 0.12, surprise: 0.06 }),
        item("Playful chaotic", "Surprising, lively, and less predictable.", ["people", "presence"], { novelty: 0.22, surprise: 0.24, structure: -0.12 }),
        item("Elegant composed", "Measured, polished, and socially legible.", ["people", "presence"], { rigor: 0.18, structure: 0.14, aesthetics: 0.2 }),
        item("Bold magnetic", "High-force attention and visible confidence.", ["people", "presence"], { surprise: 0.18, aesthetics: 0.14, novelty: 0.08 }),
        item("Nerdy focused", "Interest-led, idea-heavy, and specific.", ["people", "presence"], { rigor: 0.16, depth: 0.18, familiarity: 0.04 }),
        item("Grounded practical", "Stable, plainspoken, and useful.", ["people", "presence"], { simplicity: 0.22, structure: 0.12, familiarity: 0.16 }),
        item("Mysterious artistic", "Distance, ambiguity, and sensory pull.", ["people", "presence"], { aesthetics: 0.24, depth: 0.22, surprise: 0.14 })
      ]
    },
    {
      slug: "conversation-styles",
      title: "Conversation styles",
      description: "Preferred ways of talking and relating.",
      items: [
        item("Direct and concise", "Short lines, low ambiguity, fast decisions.", ["people", "conversation"], { simplicity: 0.34, rigor: 0.16, structure: 0.18 }),
        item("Thoughtful and deep", "Longer reflection and layered meaning.", ["people", "conversation"], { depth: 0.36, rigor: 0.1, familiarity: 0.06 }),
        item("Funny and teasing", "Play built into the exchange.", ["people", "conversation"], { surprise: 0.2, familiarity: 0.1, novelty: 0.06 }),
        item("Soft and validating", "Warmth, gentleness, and safety cues.", ["people", "conversation"], { familiarity: 0.24, simplicity: 0.08, depth: 0.06 }),
        item("Debate-heavy", "Argument, edge, and intellectual sparring.", ["people", "conversation"], { rigor: 0.24, surprise: 0.08, structure: 0.14 }),
        item("Story-rich", "Narrative, detail, and associative movement.", ["people", "conversation"], { depth: 0.22, novelty: 0.08, structure: -0.04 }),
        item("Flirtatious", "Charged ambiguity and playful signal testing.", ["people", "conversation"], { surprise: 0.24, aesthetics: 0.08, familiarity: -0.02 }),
        item("Calm and practical", "Useful, steady, and low-drama communication.", ["people", "conversation"], { simplicity: 0.24, structure: 0.12, familiarity: 0.12 })
      ]
    }
  ],
  media: [
    {
      slug: "film-moods",
      title: "Film moods",
      description: "Starter film and series mood preferences.",
      items: [
        item("Quiet drama", "Human-scale tension and emotional precision.", ["media", "film"], { depth: 0.32, rigor: 0.12, familiarity: 0.04 }),
        item("Fast thriller", "Pressure, pace, and decisive momentum.", ["media", "film"], { surprise: 0.18, structure: 0.18, simplicity: 0.08 }),
        item("Weird arthouse", "Ambiguity, visual intention, and novelty.", ["media", "film"], { novelty: 0.34, aesthetics: 0.24, surprise: 0.16 }),
        item("Romantic comedy", "Ease, charm, and reliable emotional lift.", ["media", "film"], { familiarity: 0.28, simplicity: 0.12, aesthetics: 0.08 }),
        item("Epic sci-fi", "Scale, systems, and imagined worlds.", ["media", "film"], { novelty: 0.22, depth: 0.18, rigor: 0.12 }),
        item("Documentary", "Reality, learning, and structured attention.", ["media", "film"], { rigor: 0.26, depth: 0.14, structure: 0.1 }),
        item("Animated style piece", "Visual invention and tonal freedom.", ["media", "film"], { aesthetics: 0.26, surprise: 0.14, novelty: 0.18 }),
        item("Comfort rewatch", "Low-risk familiarity and emotional ease.", ["media", "film"], { familiarity: 0.34, simplicity: 0.12, novelty: -0.08 })
      ]
    },
    {
      slug: "reading-modes",
      title: "Reading modes",
      description: "Starter list for how someone likes to read and learn.",
      items: [
        item("Dense nonfiction", "Structured ideas and argument.", ["media", "reading"], { rigor: 0.38, depth: 0.24, structure: 0.18 }),
        item("Literary fiction", "Language, psychology, and atmosphere.", ["media", "reading"], { depth: 0.34, aesthetics: 0.16, surprise: 0.06 }),
        item("Fast mystery", "Compulsion, pace, and narrative hooks.", ["media", "reading"], { simplicity: 0.08, surprise: 0.16, structure: 0.14 }),
        item("Poetry", "Compression, image, and resonant ambiguity.", ["media", "reading"], { aesthetics: 0.26, depth: 0.22, simplicity: -0.04 }),
        item("Long fantasy", "World-building and immersive continuity.", ["media", "reading"], { depth: 0.26, novelty: 0.14, familiarity: 0.08 }),
        item("Essays", "Compact thought with personal voice.", ["media", "reading"], { rigor: 0.18, depth: 0.18, simplicity: 0.08 }),
        item("Practical guides", "Actionable knowledge and direct utility.", ["media", "reading"], { simplicity: 0.34, structure: 0.2, rigor: 0.12 }),
        item("Comics and graphic novels", "Visual pacing and low-friction narrative.", ["media", "reading"], { aesthetics: 0.2, simplicity: 0.16, surprise: 0.08 })
      ]
    },
    {
      slug: "music-energy",
      title: "Music energy",
      description: "Starter music preference rounds across energy and texture.",
      items: [
        item("Ambient", "Low-beat atmosphere and spacious calm.", ["media", "music"], { depth: 0.2, simplicity: 0.18, familiarity: 0.04 }),
        item("Jazz", "Improvisation, texture, and complexity.", ["media", "music"], { rigor: 0.22, depth: 0.18, surprise: 0.12 }),
        item("Pop", "Immediate hooks and wide accessibility.", ["media", "music"], { familiarity: 0.24, simplicity: 0.14, surprise: 0.02 }),
        item("Electronic club", "Pulse, repetition, and physical momentum.", ["media", "music"], { surprise: 0.16, structure: 0.08, novelty: 0.12 }),
        item("Indie folk", "Warm narrative intimacy and acoustic texture.", ["media", "music"], { familiarity: 0.16, depth: 0.12, aesthetics: 0.1 }),
        item("Classical", "Formal shape and layered composition.", ["media", "music"], { rigor: 0.34, depth: 0.16, structure: 0.22 }),
        item("Hip-hop", "Rhythm, edge, and verbal force.", ["media", "music"], { surprise: 0.12, familiarity: 0.04, structure: 0.08 }),
        item("Metal", "Intensity, aggression, and cathartic force.", ["media", "music"], { surprise: 0.2, depth: 0.08, novelty: 0.08 })
      ]
    }
  ],
  tools: [
    {
      slug: "workflow-surfaces",
      title: "Workflow surfaces",
      description: "Starter productivity and making surfaces.",
      items: [
        item("Paper notebook", "Physical, focused, and low-interruption.", ["tools", "workflow"], { simplicity: 0.34, familiarity: 0.2, depth: 0.08 }),
        item("Whiteboard wall", "Spatial thinking and visible iteration.", ["tools", "workflow"], { novelty: 0.12, structure: 0.06, surprise: 0.04 }),
        item("Kanban board", "State-based flow and visible queues.", ["tools", "workflow"], { structure: 0.34, rigor: 0.16, simplicity: 0.1 }),
        item("Text editor", "Fast raw expression with low chrome.", ["tools", "workflow"], { simplicity: 0.28, rigor: 0.14, depth: 0.08 }),
        item("Visual canvas", "Blocks, cards, and freer arrangement.", ["tools", "workflow"], { aesthetics: 0.16, novelty: 0.12, structure: -0.04 }),
        item("Spreadsheet", "Cells, precision, and direct manipulation.", ["tools", "workflow"], { rigor: 0.34, structure: 0.22, aesthetics: -0.08 }),
        item("Voice notes", "Faster capture when writing is too slow.", ["tools", "workflow"], { simplicity: 0.18, surprise: 0.06, structure: -0.08 }),
        item("Camera roll capture", "Visual fragments first, organization later.", ["tools", "workflow"], { novelty: 0.1, aesthetics: 0.14, structure: -0.1 })
      ]
    },
    {
      slug: "capture-modes",
      title: "Capture modes",
      description: "Starter list for how ideas or evidence should be captured.",
      items: [
        item("Typed bullet list", "Fast, direct, and easy to scan later.", ["tools", "capture"], { simplicity: 0.36, structure: 0.18, rigor: 0.08 }),
        item("Longform note", "Full context and narrative memory.", ["tools", "capture"], { depth: 0.34, rigor: 0.1, structure: 0.08 }),
        item("Voice memo", "Spoken immediacy and emotional tone.", ["tools", "capture"], { simplicity: 0.12, familiarity: 0.04, structure: -0.08 }),
        item("Photo with caption", "Fast evidence with minimal text.", ["tools", "capture"], { aesthetics: 0.14, simplicity: 0.18, structure: -0.02 }),
        item("Template form", "Consistent fields and auditability.", ["tools", "capture"], { rigor: 0.26, structure: 0.28, simplicity: 0.12 }),
        item("Mind map", "Associative structure and quick branching.", ["tools", "capture"], { novelty: 0.14, depth: 0.1, structure: 0.02 }),
        item("Checklists", "Execution first and little ambiguity.", ["tools", "capture"], { simplicity: 0.28, structure: 0.22, rigor: 0.08 }),
        item("Timeline log", "Sequence, causality, and event fidelity.", ["tools", "capture"], { rigor: 0.2, depth: 0.08, structure: 0.22 })
      ]
    }
  ],
  custom: [
    {
      slug: "ambient-preferences",
      title: "Ambient preferences",
      description: "General starter set for the mood of spaces and experiences.",
      items: [
        item("Quiet", "Low stimulus and more room to think.", ["custom", "ambient"], { simplicity: 0.24, depth: 0.12, surprise: -0.08 }),
        item("Lively", "Movement, people, and visible energy.", ["custom", "ambient"], { novelty: 0.12, surprise: 0.16, familiarity: 0.02 }),
        item("Structured", "Predictable shape and clear expectations.", ["custom", "ambient"], { structure: 0.3, rigor: 0.12, simplicity: 0.08 }),
        item("Loose and spontaneous", "More drift, less script.", ["custom", "ambient"], { novelty: 0.16, surprise: 0.2, structure: -0.18 }),
        item("Minimal", "Reduced clutter and fewer competing signals.", ["custom", "ambient"], { simplicity: 0.36, aesthetics: 0.1, rigor: 0.08 }),
        item("Layered and textured", "More sensory detail and complexity.", ["custom", "ambient"], { depth: 0.16, aesthetics: 0.18, surprise: 0.08 }),
        item("Familiar", "Known terrain and easy prediction.", ["custom", "ambient"], { familiarity: 0.38, novelty: -0.12, surprise: -0.08 }),
        item("Surprising", "Fresh signal and interruption of routine.", ["custom", "ambient"], { novelty: 0.3, surprise: 0.3, familiarity: -0.16 })
      ]
    },
    {
      slug: "social-modes",
      title: "Social modes",
      description: "General starter set for how interaction should feel.",
      items: [
        item("Intimate", "Small scale and high trust.", ["custom", "social"], { depth: 0.24, familiarity: 0.18, structure: 0.06 }),
        item("Playful", "Lightness and fast back-and-forth.", ["custom", "social"], { surprise: 0.16, novelty: 0.08, familiarity: 0.04 }),
        item("Intellectual", "Ideas and argument matter most.", ["custom", "social"], { rigor: 0.22, depth: 0.16, structure: 0.12 }),
        item("Romantic", "Charge, softness, and attention.", ["custom", "social"], { aesthetics: 0.16, depth: 0.12, surprise: 0.1 }),
        item("Calm", "Lower pressure and more emotional space.", ["custom", "social"], { simplicity: 0.18, familiarity: 0.14, surprise: -0.06 }),
        item("High-energy", "Momentum, noise, and visible enthusiasm.", ["custom", "social"], { novelty: 0.08, surprise: 0.18, structure: -0.04 }),
        item("Reliable", "Trustworthy, repeatable, and stable.", ["custom", "social"], { familiarity: 0.24, structure: 0.14, rigor: 0.08 }),
        item("Mysterious", "Ambiguity and slower reveal.", ["custom", "social"], { depth: 0.18, surprise: 0.16, familiarity: -0.08 })
      ]
    }
  ]
};

export function getPreferenceCatalogSeeds(
  domain: PreferenceDomain
): PreferenceCatalogSeed[] {
  return PREFERENCE_CATALOG_SEEDS[domain] ?? [];
}
