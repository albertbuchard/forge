import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import {
  buildFoodDraftFromInput,
  buildFoodLogInput,
  buildInitialCustomFoodDraft,
  WeightLossFoodLogDialog,
  type WeightLossFoodDraft
} from "./weight-loss-food-log-dialog";

afterEach(cleanup);

function draftWithFood(
  amount: string,
  unit: "serving" | "grams" | "unit" | "tsp" | "tbsp" | "cup",
  foodPatch: Partial<WeightLossFoodDraft["selectedItems"][number]["food"]> = {}
): WeightLossFoodDraft {
  return {
    mealLabel: "Meal",
    notes: "",
    selectedItems: [
      {
        localId: "burger",
        amount,
        unit,
        food: {
          id: "food_burger",
          source: "test",
          sourceId: "burger",
          name: "Maxi Cheese Burger",
          brand: "Charal",
          barcode: null,
          servingLabel: "220 g",
          servingGrams: 220,
          calories: 563.2,
          proteinGrams: 28.6,
          carbohydrateGrams: 44,
          fatGrams: 28.6,
          fiberGrams: null,
          sugarGrams: 13,
          sodiumMg: 1214,
          potassiumMg: null,
          caffeineMg: null,
          alcoholGrams: null,
          glycemicIndex: null,
          novaGroup: null,
          tags: [],
          confidence: 0.9,
          ...foodPatch
        }
      }
    ]
  };
}

describe("buildFoodLogInput", () => {
  it("scales grams by eaten grams divided by base grams", () => {
    const input = buildFoodLogInput(draftWithFood("2", "grams"));
    expect(input.notes).toBe("");
    expect(input.items[0]).toMatchObject({
      quantity: 2,
      unit: "grams",
      grams: 2,
      calories: 5.1,
      proteinGrams: 0.3,
      carbohydrateGrams: 0.4,
      fatGrams: 0.3,
      sodiumMg: 11
    });
  });

  it("scales servings as multiples of the base serving", () => {
    const input = buildFoodLogInput(draftWithFood("2", "serving"));
    expect(input.items[0]).toMatchObject({
      quantity: 2,
      unit: "serving",
      grams: 440,
      calories: 1126.4,
      proteinGrams: 57.2
    });
  });

  it("parses legacy gram labels when servingGrams is missing", () => {
    const input = buildFoodLogInput(
      draftWithFood("2", "grams", {
        servingGrams: null,
        calories: 256,
        proteinGrams: 13,
        carbohydrateGrams: 20,
        fatGrams: 13,
        sodiumMg: 552
      })
    );
    expect(input.items[0]).toMatchObject({
      grams: 2,
      calories: 2.3,
      proteinGrams: 0.1,
      carbohydrateGrams: 0.2,
      fatGrams: 0.1,
      sodiumMg: 5
    });
  });

  it("converts household units through gram equivalents before scaling", () => {
    const input = buildFoodLogInput(draftWithFood("2", "tbsp"));
    expect(input.items[0]).toMatchObject({
      quantity: 2,
      unit: "tbsp",
      grams: 30,
      calories: 76.8,
      proteinGrams: 3.9,
      carbohydrateGrams: 6,
      fatGrams: 3.9,
      sodiumMg: 165.5
    });
  });

  it("does not guess gram-ratio nutrients when the base gram denominator is unknown", () => {
    const input = buildFoodLogInput(
      draftWithFood("2", "grams", {
        servingLabel: "one burger",
        servingGrams: null
      })
    );
    expect(input.items[0]).toMatchObject({
      quantity: 2,
      unit: "grams",
      grams: 2,
      calories: null,
      proteinGrams: null,
      carbohydrateGrams: null,
      fatGrams: null,
      sodiumMg: null
    });
  });

  it("turns ChatGPT parsed meal candidates into editable draft foods without double-counting", () => {
    const draft = buildFoodDraftFromInput(
      {
        mealLabel: "Breakfast",
        source: "chatgpt",
        confirmationState: "candidate",
        notes: "estimated",
        items: [
          {
            name: "Greek yogurt",
            quantity: 150,
            unit: "g",
            grams: 150,
            calories: 140,
            proteinGrams: 15,
            carbohydrateGrams: 6,
            fatGrams: 4,
            confidence: 0.55,
            tags: ["chatgpt_estimate"]
          }
        ]
      },
      "chatgpt"
    );

    expect(draft).toMatchObject({
      mealLabel: "Breakfast",
      notes: "estimated",
      selectedItems: [
        {
          amount: "150",
          unit: "grams",
          food: {
            name: "Greek yogurt",
            source: "chatgpt",
            servingGrams: 150,
            calories: 140,
            proteinGrams: 15,
            tags: ["chatgpt_estimate"]
          }
        }
      ]
    });

    const input = buildFoodLogInput(draft);
    expect(input.source).toBe("chatgpt");
    expect(input.items[0]).toMatchObject({
      foodId: null,
      quantity: 150,
      unit: "grams",
      grams: 150,
      calories: 140,
      proteinGrams: 15
    });
  });

  it("logs custom foods without pretending they already exist in the catalog", () => {
    const draft = buildInitialCustomFoodDraft();
    draft.selectedItems[0] = {
      ...draft.selectedItems[0],
      amount: "40",
      unit: "grams",
      food: {
        ...draft.selectedItems[0].food,
        name: "Homemade sauce",
        calories: 120,
        fatGrams: 10,
        servingGrams: 100
      }
    };

    const input = buildFoodLogInput(draft);
    expect(input.source).toBe("manual");
    expect(input.items[0]).toMatchObject({
      foodId: null,
      name: "Homemade sauce",
      quantity: 40,
      unit: "grams",
      grams: 40,
      calories: 48,
      fatGrams: 4
    });
  });

  it("sanitizes restored null meal notes before saving", () => {
    const draft = draftWithFood(
      "1",
      "serving"
    ) as unknown as WeightLossFoodDraft;
    Object.assign(draft, { notes: null, mealLabel: null });

    const input = buildFoodLogInput(draft);
    expect(input.mealLabel).toBe("");
    expect(input.notes).toBe("");
  });

  it("passes the selected day and timezone when the draft has no dayKey", () => {
    const input = buildFoodLogInput(draftWithFood("1", "serving"), {
      dateKey: "2030-01-02",
      timeZone: "Europe/Zurich"
    });

    expect(input.dayKey).toBe("2030-01-02");
    expect(input.timeZone).toBe("Europe/Zurich");
  });

  it("keeps an explicit empty meal marker instead of inventing a default label", () => {
    const draft = buildFoodDraftFromInput(
      {
        mealLabel: "",
        source: "manual",
        items: [
          {
            name: "Plain yogurt",
            quantity: 100,
            unit: "g",
            calories: 60
          }
        ]
      },
      "manual"
    );

    expect(draft.mealLabel).toBe("");
    expect(buildFoodLogInput(draft).mealLabel).toBe("");
  });
});

describe("WeightLossFoodLogDialog", () => {
  it("shows animated parser state while ChatGPT parsing is running", () => {
    render(
      <WeightLossFoodLogDialog
        open
        onOpenChange={() => undefined}
        value={buildInitialCustomFoodDraft()}
        onChange={() => undefined}
        foodResults={[]}
        searchPending={false}
        chatGptPending
        logPending={false}
        intent="chatgpt"
        onSearch={() => undefined}
        onParseWithChatGpt={async () => undefined}
        onSubmit={async () => undefined}
      />
    );

    expect(screen.getByText("Reading the meal text")).toBeTruthy();
    expect(
      screen.getByText(/matching foods, and refusing incomplete nutrition/i)
    ).toBeTruthy();
  });

  it("shows ChatGPT parse summary and nudges the next modal step", () => {
    const draft = buildFoodDraftFromInput(
      {
        mealLabel: "Snack",
        source: "chatgpt",
        confirmationState: "candidate",
        notes: "",
        items: [
          {
            name: "Gouda",
            quantity: 100,
            unit: "grams",
            grams: 100,
            calories: 356,
            proteinGrams: 25,
            carbohydrateGrams: 2.2,
            fatGrams: 27
          },
          {
            name: "Almonds",
            quantity: 20,
            unit: "piece",
            grams: 24,
            calories: 138.96,
            proteinGrams: 5.09,
            carbohydrateGrams: 5.18,
            fatGrams: 11.98
          }
        ]
      },
      "chatgpt"
    );

    render(
      <WeightLossFoodLogDialog
        open
        onOpenChange={() => undefined}
        value={draft}
        onChange={() => undefined}
        foodResults={[]}
        searchPending={false}
        chatGptPending={false}
        chatGptFeedback={{
          status: "success",
          summary: {
            itemCount: 2,
            completeNutritionItemCount: 2,
            catalogResolvedItemCount: 2,
            chatGptEstimatedItemCount: 0,
            chatGptValidatedItemCount: 0,
            elapsedMs: 920,
            llmCallCount: 1
          }
        }}
        logPending={false}
        intent="chatgpt"
        onSearch={() => undefined}
        onParseWithChatGpt={async () => undefined}
        onSubmit={async () => undefined}
      />
    );

    expect(screen.getByText("2 foods added to the draft")).toBeTruthy();
    expect(screen.getByText("2/2 complete")).toBeTruthy();
    expect(
      screen.getByText("Meal draft is ready. Continue to review quantities.")
    ).toBeTruthy();
  });

  it("blocks saving when a selected food lacks required nutrition", () => {
    const draft = buildInitialCustomFoodDraft();
    draft.selectedItems[0] = {
      ...draft.selectedItems[0],
      food: {
        ...draft.selectedItems[0].food,
        name: "Incomplete custom food",
        calories: 120,
        proteinGrams: 4,
        carbohydrateGrams: 18,
        fatGrams: null
      }
    };

    render(
      <WeightLossFoodLogDialog
        open
        onOpenChange={() => undefined}
        value={draft}
        onChange={() => undefined}
        foodResults={[]}
        searchPending={false}
        logPending={false}
        initialStepId="amounts"
        onSearch={() => undefined}
        onSubmit={async () => undefined}
      />
    );

    expect(
      screen.getAllByText(/Incomplete custom food is missing fat/).length
    ).toBeGreaterThan(0);
  });
});
