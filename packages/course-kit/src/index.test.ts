import { describe, expect, it } from "vitest";
import { defineCoursePackage, stableJson, toLearnerLesson } from "./index";

function basePackage() {
  return {
    schemaVersion: "1.0" as const,
    course: {
      id: "course.contract-test",
      slug: "contract-test",
      version: "1.0.0",
      title: "Contract test",
      description: "A portable contract fixture.",
      authors: ["Forge"],
      license: "CC0-1.0",
      estimatedWeeks: 1,
      minutesPerWeek: 30,
      entryLessonId: "lesson.one"
    },
    concepts: [
      {
        id: "concept.one",
        slug: "concept-one",
        title: "Concept one",
        summary: "A canonical concept.",
        definitionMarkdown: "A definition."
      }
    ],
    modules: [
      {
        id: "module.one",
        title: "Module one",
        description: "The first module.",
        order: 0,
        startWeek: 1,
        endWeek: 1,
        lessonIds: ["lesson.one"]
      }
    ],
    lessons: [
      {
        id: "lesson.one",
        moduleId: "module.one",
        week: 1,
        day: 1,
        order: 0,
        title: "Lesson one",
        summary: "The first lesson.",
        estimatedMinutes: 30,
        conceptIds: ["concept.one"],
        objectives: ["Write a proof."],
        content: [{ type: "markdown" as const, markdown: "Study the claim." }],
        activities: [
          {
            id: "proof.one",
            type: "proof" as const,
            title: "Prove it",
            promptMarkdown: "Prove the claim.",
            conceptIds: ["concept.one"],
            points: 10,
            estimatedMinutes: 20,
            rubric: [
              {
                id: "correctness",
                label: "Correctness",
                description: "The conclusion follows.",
                weight: 1
              }
            ],
            referenceAnswerMarkdown: "The hidden instructor proof.",
            hints: []
          }
        ]
      }
    ],
    provenance: {
      generatedAt: "2026-07-22T00:00:00.000Z",
      contentHash: ""
    }
  };
}

describe("Forge Course Kit", () => {
  it("applies strong defaults and strips every answer-bearing proof field", () => {
    const parsed = defineCoursePackage(basePackage());
    expect(parsed.presentation.preset).toBe("forge.paper");
    expect(parsed.grading.masteryDimensions).toHaveLength(4);
    expect(parsed.lessons[0]?.activities[0]?.reviewAfterDays).toEqual([
      1, 3, 8, 16
    ]);
    expect(stableJson(toLearnerLesson(parsed.lessons[0]!))).not.toContain(
      "referenceAnswerMarkdown"
    );
  });

  it("allows a course to reference a shared concept without redefining it", () => {
    const fixture = basePackage();
    const parsed = defineCoursePackage({
      ...fixture,
      course: {
        ...fixture.course,
        id: "course.reference-test",
        slug: "reference-test"
      },
      concepts: [],
      conceptRefs: [{ id: "concept.shared" }],
      lessons: fixture.lessons.map((lesson) => ({
        ...lesson,
        conceptIds: ["concept.shared"],
        activities: lesson.activities.map((activity) => ({
          ...activity,
          conceptIds: ["concept.shared"]
        }))
      }))
    });
    expect(parsed.concepts).toHaveLength(0);
    expect(parsed.conceptRefs[0]?.id).toBe("concept.shared");
  });

  it("resolves an omitted lesson layout from the course presentation", () => {
    const fixture = basePackage();
    const parsed = defineCoursePackage({
      ...fixture,
      presentation: { defaultLessonLayoutId: "forge.test-layout" }
    });
    expect(parsed.lessons[0]?.layoutId).toBe("forge.test-layout");
  });

  it("rejects activities that name undeclared mastery dimensions", () => {
    const fixture = basePackage();
    expect(() =>
      defineCoursePackage({
        ...fixture,
        lessons: fixture.lessons.map((lesson) => ({
          ...lesson,
          activities: lesson.activities.map((activity) => ({
            ...activity,
            masteryDimensionIds: ["dimension.missing"]
          }))
        }))
      })
    ).toThrow(/missing mastery dimension/u);
  });

  it("rejects activity ids reused across lessons", () => {
    const fixture = basePackage();
    const secondLesson = {
      ...fixture.lessons[0]!,
      id: "lesson.two",
      day: 2,
      order: 1,
      title: "Lesson two"
    };
    expect(() =>
      defineCoursePackage({
        ...fixture,
        modules: fixture.modules.map((module) => ({
          ...module,
          lessonIds: ["lesson.one", "lesson.two"]
        })),
        lessons: [...fixture.lessons, secondLesson]
      })
    ).toThrow(/duplicate activity ids: proof.one/iu);
  });

  it("supports a CPGE-style course with shared concepts and custom pedagogy", () => {
    const parsed = defineCoursePackage({
      schemaVersion: "1.0",
      course: {
        id: "course.cpge-contract-fixture",
        slug: "cpge-contract-fixture",
        version: "0.0.0-contract",
        title: "CPGE contract fixture",
        description:
          "A contract-only fixture proving that a second pedagogy needs no Forge core change.",
        authors: ["Forge Course Kit"],
        license: "CC0-1.0",
        estimatedWeeks: 1,
        minutesPerWeek: 240,
        entryLessonId: "lesson.cpge-problem"
      },
      presentation: {
        preset: "cpge.chalk",
        brandLabel: "Concours studio",
        defaultLessonLayoutId: "cpge.problem-sheet",
        extensions: [
          { namespace: "org.example.cpge", version: "1", required: true }
        ]
      },
      grading: {
        attemptAggregation: "best",
        pointsPolicy: "positive_delta",
        gradeScale: [
          { minimum: 80, label: "Très solide" },
          { minimum: 60, label: "Admissible" },
          { minimum: 0, label: "À reprendre" }
        ],
        masteryDimensions: [
          {
            id: "proof_reproduction",
            label: "Proof reproduction",
            description: "Reconstruct a rigorous argument without notes.",
            weight: 0.4
          },
          {
            id: "timed_fluency",
            label: "Timed fluency",
            description: "Choose and execute a method under concours timing.",
            weight: 0.35
          },
          {
            id: "oral_exposition",
            label: "Oral exposition",
            description: "Present definitions and proofs at the board.",
            weight: 0.25
          }
        ],
        competencies: [
          {
            id: "strategy_selection",
            label: "Strategy selection",
            description: "Choose a viable lemma or reduction."
          }
        ],
        misconceptions: [
          {
            id: "hypothesis_dropped",
            label: "Hypothesis dropped",
            description: "A theorem is used without one of its hypotheses.",
            remediationConceptIds: ["concept.proof"]
          }
        ],
        assessmentProfiles: [
          {
            id: "written_timed",
            label: "Four-hour written problem",
            timed: true
          },
          {
            id: "oral_board",
            label: "Oral board proof",
            oral: true
          }
        ],
        defaultAssessmentProfileId: "written_timed"
      },
      concepts: [
        {
          id: "concept.concours-strategy",
          slug: "concours-strategy",
          title: "Concours strategy",
          summary: "Select and revise a proof strategy under time pressure.",
          definitionMarkdown:
            "A strategy is a justified sequence of reductions toward the target claim.",
          masteryDimensionIds: ["timed_fluency", "oral_exposition"]
        }
      ],
      conceptRefs: [{ id: "concept.proof" }],
      modules: [
        {
          id: "module.cpge",
          title: "Problem laboratory",
          description: "One written and one oral-compatible activity.",
          order: 0,
          startWeek: 1,
          endWeek: 1,
          lessonIds: ["lesson.cpge-problem"]
        }
      ],
      lessons: [
        {
          id: "lesson.cpge-problem",
          moduleId: "module.cpge",
          week: 1,
          day: 1,
          order: 0,
          title: "Timed proof laboratory",
          summary: "Write, critique, and orally reconstruct one proof.",
          estimatedMinutes: 240,
          conceptIds: ["concept.proof", "concept.concours-strategy"],
          objectives: ["Choose and defend a proof strategy."],
          content: [
            {
              type: "extension",
              namespace: "org.example.cpge",
              renderer: "problem_sheet",
              version: "1",
              data: { columns: 2, showTimer: true }
            }
          ],
          activities: [
            {
              id: "activity.cpge-proof",
              type: "proof",
              title: "Written proof",
              promptMarkdown:
                "Prove the stated claim under concours conditions.",
              conceptIds: ["concept.proof", "concept.concours-strategy"],
              masteryDimensionIds: ["proof_reproduction", "timed_fluency"],
              competencyIds: ["strategy_selection"],
              assessmentProfileId: "written_timed",
              points: 20,
              estimatedMinutes: 180,
              rubric: [
                {
                  id: "proof",
                  label: "Proof",
                  description: "The proof is correct and complete.",
                  weight: 1,
                  masteryDimensionIds: ["proof_reproduction"],
                  misconceptionIds: ["hypothesis_dropped"]
                }
              ],
              referenceAnswerMarkdown: "A complete instructor proof."
            },
            {
              id: "activity.cpge-oral",
              type: "extension",
              title: "Oral reconstruction",
              promptMarkdown: "Present the proof at the board.",
              conceptIds: ["concept.proof", "concept.concours-strategy"],
              masteryDimensionIds: ["oral_exposition"],
              assessmentProfileId: "oral_board",
              points: 10,
              estimatedMinutes: 20,
              namespace: "org.example.cpge",
              renderer: "oral_capture",
              version: "1",
              responseMode: "text",
              config: { maxMinutes: 20 },
              assessment: { expectedStructure: ["claim", "proof", "check"] }
            }
          ]
        }
      ],
      provenance: {
        generatedAt: "2026-07-22T00:00:00.000Z",
        contentHash: ""
      }
    });

    expect(parsed.lessons[0]?.layoutId).toBe("cpge.problem-sheet");
    expect(parsed.grading.assessmentProfiles).toHaveLength(2);
    expect(parsed.conceptRefs[0]?.id).toBe("concept.proof");
    expect(stableJson(toLearnerLesson(parsed.lessons[0]!))).not.toContain(
      "expectedStructure"
    );
  });
});
