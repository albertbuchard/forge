import {
  FlowChoiceGrid,
  FlowField
} from "@/components/flows/question-flow-dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/work/work-dialog-helpers";
import type { CriteriaDraft } from "@/components/work/work-campaign-criteria-model";

export function CriteriaFields({
  value,
  setValue
}: {
  value: CriteriaDraft;
  setValue: (patch: Partial<CriteriaDraft>) => void;
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <FlowField label="Desired title families" hint="One per line">
        <Textarea
          rows={5}
          value={value.desiredTitles}
          onChange={(event) => setValue({ desiredTitles: event.target.value })}
          placeholder="Machine learning research scientist"
        />
      </FlowField>
      <FlowField label="Excluded titles" hint="Hard exclusions; one per line">
        <Textarea
          rows={5}
          value={value.excludedTitles}
          onChange={(event) => setValue({ excludedTitles: event.target.value })}
        />
      </FlowField>
      <FlowField label="Allowed or preferred locations" hint="One per line">
        <Textarea
          rows={4}
          value={value.locations}
          onChange={(event) => setValue({ locations: event.target.value })}
        />
      </FlowField>
      <NativeSelect
        label="Preferred work model"
        value={value.workModel}
        onChange={(workModel) =>
          setValue({ workModel: workModel as CriteriaDraft["workModel"] })
        }
      >
        <option value="any">Flexible / any</option>
        <option value="remote">Remote</option>
        <option value="hybrid">Hybrid</option>
        <option value="on_site">On site</option>
      </NativeSelect>
      <FlowField label="Minimum gross annual compensation">
        <Input
          type="number"
          min="0"
          value={value.minimumCompensation}
          onChange={(event) =>
            setValue({ minimumCompensation: event.target.value })
          }
        />
      </FlowField>
      <FlowField label="Currency">
        <Input
          maxLength={3}
          value={value.currency}
          onChange={(event) =>
            setValue({ currency: event.target.value.toUpperCase().slice(0, 3) })
          }
        />
      </FlowField>
      <FlowField label="Minimum weekly hours">
        <Input
          type="number"
          min="0"
          max="168"
          value={value.minimumHours}
          onChange={(event) => setValue({ minimumHours: event.target.value })}
        />
      </FlowField>
      <FlowField label="Maximum weekly hours">
        <Input
          type="number"
          min="0"
          max="168"
          value={value.maximumHours}
          onChange={(event) => setValue({ maximumHours: event.target.value })}
        />
      </FlowField>
      <FlowField label="Include keywords" hint="One per line">
        <Textarea
          rows={4}
          value={value.includeKeywords}
          onChange={(event) =>
            setValue({ includeKeywords: event.target.value })
          }
        />
      </FlowField>
      <FlowField label="Exclude keywords" hint="One per line">
        <Textarea
          rows={4}
          value={value.excludeKeywords}
          onChange={(event) =>
            setValue({ excludeKeywords: event.target.value })
          }
        />
      </FlowField>
      <FlowField label="Deal-breakers" hint="One per line">
        <Textarea
          rows={4}
          value={value.dealBreakers}
          onChange={(event) => setValue({ dealBreakers: event.target.value })}
        />
      </FlowField>
      <FlowField label="Acceptable trade-offs" hint="One per line">
        <Textarea
          rows={4}
          value={value.tradeoffs}
          onChange={(event) => setValue({ tradeoffs: event.target.value })}
        />
      </FlowField>
      <NativeSelect
        label="Uncertainty tolerance"
        value={value.uncertaintyTolerance}
        onChange={(uncertaintyTolerance) =>
          setValue({
            uncertaintyTolerance:
              uncertaintyTolerance as CriteriaDraft["uncertaintyTolerance"]
          })
        }
      >
        <option value="low">Low</option>
        <option value="medium">Medium</option>
        <option value="high">High</option>
      </NativeSelect>
    </div>
  );
}

export function AdvancedCriteriaFields({
  value,
  setValue
}: {
  value: CriteriaDraft;
  setValue: (patch: Partial<CriteriaDraft>) => void;
}) {
  const heading = (title: string, description: string) => (
    <div className="md:col-span-2">
      <h3 className="text-sm font-semibold text-[var(--ui-ink-strong)]">
        {title}
      </h3>
      <p className="mt-1 text-xs leading-5 text-[var(--ui-ink-soft)]">
        {description}
      </p>
    </div>
  );
  return (
    <div className="grid gap-6">
      <section className="grid gap-4 md:grid-cols-2">
        {heading(
          "Role shape and responsibility balance",
          "Describe the actual function, activity mix, authority, exposure, and freedom that matter—not only the title."
        )}
        <FlowField label="Desired functions" hint="One per line">
          <Textarea
            rows={4}
            value={value.desiredFunctions}
            onChange={(event) =>
              setValue({ desiredFunctions: event.target.value })
            }
          />
        </FlowField>
        <FlowField
          label="Excluded functions"
          hint="Hard exclusions; one per line"
        >
          <Textarea
            rows={4}
            value={value.excludedFunctions}
            onChange={(event) =>
              setValue({ excludedFunctions: event.target.value })
            }
          />
        </FlowField>
        <FlowField label="Role families and disciplines" hint="One per line">
          <Textarea
            rows={4}
            value={value.roleFamilies}
            onChange={(event) => setValue({ roleFamilies: event.target.value })}
          />
        </FlowField>
        <FlowField label="Seniority or career levels" hint="One per line">
          <Textarea
            rows={4}
            value={value.seniorityLevels}
            onChange={(event) =>
              setValue({ seniorityLevels: event.target.value })
            }
          />
        </FlowField>
        <FlowField label="Sectors and problem areas" hint="One per line">
          <Textarea
            rows={4}
            value={value.sectors}
            onChange={(event) => setValue({ sectors: event.target.value })}
          />
        </FlowField>
        <FlowField label="Technology areas" hint="One per line">
          <Textarea
            rows={4}
            value={value.technologyAreas}
            onChange={(event) =>
              setValue({ technologyAreas: event.target.value })
            }
          />
        </FlowField>
        <FlowField
          label="Desired activity balance"
          hint="building=60, research=30, leadership=10; one per line"
        >
          <Textarea
            rows={5}
            value={value.responsibilityBalance}
            onChange={(event) =>
              setValue({ responsibilityBalance: event.target.value })
            }
          />
        </FlowField>
        <NativeSelect
          label="Career path"
          value={value.careerPath}
          onChange={(careerPath) =>
            setValue({ careerPath: careerPath as CriteriaDraft["careerPath"] })
          }
        >
          <option value="any">Any</option>
          <option value="individual_contributor">Individual contributor</option>
          <option value="management">Management</option>
        </NativeSelect>
        <FlowField label="Minimum hands-on ownership (%)">
          <Input
            type="number"
            min="0"
            max="100"
            value={value.minimumHandsOnPercent}
            onChange={(event) =>
              setValue({ minimumHandsOnPercent: event.target.value })
            }
          />
        </FlowField>
        <FlowField label="Maximum expected team size">
          <Input
            type="number"
            min="0"
            value={value.maximumTeamSize}
            onChange={(event) =>
              setValue({ maximumTeamSize: event.target.value })
            }
          />
        </FlowField>
        <FlowField
          label="Maximum on-call burden"
          hint="For example: one week per quarter"
        >
          <Input
            value={value.maximumOnCall}
            onChange={(event) =>
              setValue({ maximumOnCall: event.target.value })
            }
          />
        </FlowField>
        <FlowField label="Maximum travel (%)">
          <Input
            type="number"
            min="0"
            max="100"
            value={value.maximumTravelPercent}
            onChange={(event) =>
              setValue({ maximumTravelPercent: event.target.value })
            }
          />
        </FlowField>
        <NativeSelect
          label="Customer or clinical exposure"
          value={value.customerExposure}
          onChange={(customerExposure) =>
            setValue({
              customerExposure:
                customerExposure as CriteriaDraft["customerExposure"]
            })
          }
        >
          {["any", "preferred", "required", "excluded"].map((option) => (
            <option key={option}>{option}</option>
          ))}
        </NativeSelect>
        <NativeSelect
          label="Publication freedom"
          value={value.publicationFreedom}
          onChange={(publicationFreedom) =>
            setValue({
              publicationFreedom:
                publicationFreedom as CriteriaDraft["publicationFreedom"]
            })
          }
        >
          {["any", "preferred", "required"].map((option) => (
            <option key={option}>{option}</option>
          ))}
        </NativeSelect>
        <NativeSelect
          label="Open-source freedom"
          value={value.openSourceFreedom}
          onChange={(openSourceFreedom) =>
            setValue({
              openSourceFreedom:
                openSourceFreedom as CriteriaDraft["openSourceFreedom"]
            })
          }
        >
          {["any", "preferred", "required"].map((option) => (
            <option key={option}>{option}</option>
          ))}
        </NativeSelect>
        <FlowField label="Minimum protected research time (%)">
          <Input
            type="number"
            min="0"
            max="100"
            value={value.minimumResearchPercent}
            onChange={(event) =>
              setValue({ minimumResearchPercent: event.target.value })
            }
          />
        </FlowField>
      </section>
      <section className="grid gap-4 border-t border-[var(--ui-border-subtle)] pt-6 md:grid-cols-2">
        {heading(
          "Work pattern, geography, and availability",
          "Separate schedule and authorization constraints from preferences, and keep unknowns explicit."
        )}
        <FlowField label="Employment or engagement types" hint="One per line">
          <Textarea
            rows={4}
            value={value.employmentTypes}
            onChange={(event) =>
              setValue({ employmentTypes: event.target.value })
            }
          />
        </FlowField>
        <FlowField
          label="Excluded locations"
          hint="Countries, regions, or cities; one per line"
        >
          <Textarea
            rows={4}
            value={value.excludedLocations}
            onChange={(event) =>
              setValue({ excludedLocations: event.target.value })
            }
          />
        </FlowField>
        <FlowField label="Maximum office days per week">
          <Input
            type="number"
            min="0"
            max="7"
            value={value.maximumOfficeDays}
            onChange={(event) =>
              setValue({ maximumOfficeDays: event.target.value })
            }
          />
        </FlowField>
        <FlowField label="Maximum one-way commute (minutes)">
          <Input
            type="number"
            min="0"
            value={value.maximumCommuteMinutes}
            onChange={(event) =>
              setValue({ maximumCommuteMinutes: event.target.value })
            }
          />
        </FlowField>
        <NativeSelect
          label="Relocation"
          value={value.relocation}
          onChange={(relocation) =>
            setValue({ relocation: relocation as CriteriaDraft["relocation"] })
          }
        >
          {[
            "unknown",
            "unwilling",
            "possible",
            "willing",
            "required_support"
          ].map((option) => (
            <option key={option} value={option}>
              {option.replaceAll("_", " ")}
            </option>
          ))}
        </NativeSelect>
        <NativeSelect
          label="Sponsorship"
          value={value.sponsorship}
          onChange={(sponsorship) =>
            setValue({
              sponsorship: sponsorship as CriteriaDraft["sponsorship"]
            })
          }
        >
          {[
            "unknown",
            "not_needed",
            "needed",
            "acceptable",
            "unacceptable"
          ].map((option) => (
            <option key={option} value={option}>
              {option.replaceAll("_", " ")}
            </option>
          ))}
        </NativeSelect>
        <FlowField label="Schedule or shift constraints" hint="One per line">
          <Textarea
            rows={4}
            value={value.scheduleConstraints}
            onChange={(event) =>
              setValue({ scheduleConstraints: event.target.value })
            }
          />
        </FlowField>
        <FlowField label="Preferred working days" hint="One per line">
          <Textarea
            rows={4}
            value={value.workingDays}
            onChange={(event) => setValue({ workingDays: event.target.value })}
          />
        </FlowField>
        <FlowField label="Required timezone overlap">
          <Input
            value={value.timezoneOverlap}
            onChange={(event) =>
              setValue({ timezoneOverlap: event.target.value })
            }
          />
        </FlowField>
        <NativeSelect
          label="Side-job compatibility"
          value={value.sideJobCompatibility}
          onChange={(sideJobCompatibility) =>
            setValue({
              sideJobCompatibility:
                sideJobCompatibility as CriteriaDraft["sideJobCompatibility"]
            })
          }
        >
          {["unknown", "not_needed", "preferred", "required"].map((option) => (
            <option key={option} value={option}>
              {option.replaceAll("_", " ")}
            </option>
          ))}
        </NativeSelect>
        <FlowField label="Desired duration">
          <Input
            value={value.desiredDuration}
            onChange={(event) =>
              setValue({ desiredDuration: event.target.value })
            }
            placeholder="Open-ended, 6–12 months…"
          />
        </FlowField>
        <div className="grid grid-cols-[minmax(0,1fr)_9rem] gap-2">
          <FlowField label="Notice period">
            <Input
              type="number"
              min="0"
              value={value.noticeValue}
              onChange={(event) =>
                setValue({ noticeValue: event.target.value })
              }
            />
          </FlowField>
          <NativeSelect
            label="Unit"
            value={value.noticeUnit}
            onChange={(noticeUnit) =>
              setValue({
                noticeUnit: noticeUnit as CriteriaDraft["noticeUnit"]
              })
            }
          >
            {["days", "weeks", "months"].map((option) => (
              <option key={option}>{option}</option>
            ))}
          </NativeSelect>
        </div>
        <FlowField label="Earliest realistic start">
          <Input
            type="date"
            value={value.earliestStartDate}
            onChange={(event) =>
              setValue({ earliestStartDate: event.target.value })
            }
          />
        </FlowField>
        <FlowField label="Preferred start">
          <Input
            type="date"
            value={value.preferredStartDate}
            onChange={(event) =>
              setValue({ preferredStartDate: event.target.value })
            }
          />
        </FlowField>
        <FlowField
          label="Other availability conditions"
          hint="One per line"
          className="md:col-span-2"
        >
          <Textarea
            rows={4}
            value={value.availabilityConditions}
            onChange={(event) =>
              setValue({ availabilityConditions: event.target.value })
            }
          />
        </FlowField>
      </section>
      <section className="grid gap-4 border-t border-[var(--ui-border-subtle)] pt-6 md:grid-cols-2">
        {heading(
          "Compensation, benefits, organization, and growth",
          "Unknown compensation stays unknown. Minimums, targets, stretch values, and qualitative preferences remain distinct."
        )}
        <FlowField label="Target annual compensation">
          <Input
            type="number"
            min="0"
            value={value.targetCompensation}
            onChange={(event) =>
              setValue({ targetCompensation: event.target.value })
            }
          />
        </FlowField>
        <FlowField label="Stretch annual compensation">
          <Input
            type="number"
            min="0"
            value={value.stretchCompensation}
            onChange={(event) =>
              setValue({ stretchCompensation: event.target.value })
            }
          />
        </FlowField>
        <NativeSelect
          label="Gross or net"
          value={value.compensationBasis}
          onChange={(compensationBasis) =>
            setValue({
              compensationBasis:
                compensationBasis as CriteriaDraft["compensationBasis"]
            })
          }
        >
          {["gross", "net", "unknown"].map((option) => (
            <option key={option}>{option}</option>
          ))}
        </NativeSelect>
        <NativeSelect
          label="Negotiability"
          value={value.compensationNegotiability}
          onChange={(compensationNegotiability) =>
            setValue({
              compensationNegotiability:
                compensationNegotiability as CriteriaDraft["compensationNegotiability"]
            })
          }
        >
          {["unknown", "fixed", "negotiable"].map((option) => (
            <option key={option}>{option}</option>
          ))}
        </NativeSelect>
        <FlowField
          label="Desired benefits"
          hint="Leave, pension, health, learning budget, protected research time, equipment, flexibility, sabbatical; one per line"
          className="md:col-span-2"
        >
          <Textarea
            rows={5}
            value={value.desiredBenefits}
            onChange={(event) =>
              setValue({ desiredBenefits: event.target.value })
            }
          />
        </FlowField>
        <FlowField
          label="Preferred organization characteristics"
          hint="Size, stage, funding, stability, prestige, technical environment, pace; one per line"
        >
          <Textarea
            rows={5}
            value={value.organizationPreferences}
            onChange={(event) =>
              setValue({ organizationPreferences: event.target.value })
            }
          />
        </FlowField>
        <FlowField
          label="Excluded organization characteristics"
          hint="One per line"
        >
          <Textarea
            rows={5}
            value={value.organizationExclusions}
            onChange={(event) =>
              setValue({ organizationExclusions: event.target.value })
            }
          />
        </FlowField>
        <FlowField
          label="Culture, mission, management, and ethics"
          hint="One evidence-seeking preference per line"
        >
          <Textarea
            rows={5}
            value={value.cultureMissionEthics}
            onChange={(event) =>
              setValue({ cultureMissionEthics: event.target.value })
            }
          />
        </FlowField>
        <FlowField
          label="Growth priorities"
          hint="Learning, mentorship, network, leadership, research visibility; one per line"
        >
          <Textarea
            rows={5}
            value={value.growthPriorities}
            onChange={(event) =>
              setValue({ growthPriorities: event.target.value })
            }
          />
        </FlowField>
        <FlowField
          label="Future role paths"
          hint="Named future roles; one per line"
        >
          <Textarea
            rows={4}
            value={value.futureRolePaths}
            onChange={(event) =>
              setValue({ futureRolePaths: event.target.value })
            }
          />
        </FlowField>
        <FlowField label="Growth time horizon">
          <Input
            value={value.growthTimeHorizon}
            onChange={(event) =>
              setValue({ growthTimeHorizon: event.target.value })
            }
            placeholder="2 years"
          />
        </FlowField>
      </section>
      <section className="grid gap-4 border-t border-[var(--ui-border-subtle)] pt-6 md:grid-cols-2">
        {heading(
          "Evidence, uncertainty, and disqualification",
          "These controls tell agents what evidence is acceptable and when a role must be held for review or rejected."
        )}
        <FlowField label="Required sources" hint="One source class per line">
          <Textarea
            rows={4}
            value={value.requiredSources}
            onChange={(event) =>
              setValue({ requiredSources: event.target.value })
            }
          />
        </FlowField>
        <FlowField
          label="Custom disqualification rules"
          hint="One explicit rule per line"
        >
          <Textarea
            rows={4}
            value={value.disqualificationRules}
            onChange={(event) =>
              setValue({ disqualificationRules: event.target.value })
            }
          />
        </FlowField>
        <FlowField label="Minimum evidence confidence (%)">
          <Input
            type="number"
            min="0"
            max="100"
            value={value.minimumConfidencePercent}
            onChange={(event) =>
              setValue({ minimumConfidencePercent: event.target.value })
            }
          />
        </FlowField>
        <FlowField label="Evidence freshness (days)">
          <Input
            type="number"
            min="0"
            max="3650"
            value={value.evidenceFreshnessDays}
            onChange={(event) =>
              setValue({ evidenceFreshnessDays: event.target.value })
            }
          />
        </FlowField>
        <FlowField label="Minimum personal excitement (1–5)">
          <Input
            type="number"
            min="1"
            max="5"
            value={value.minimumExcitement}
            onChange={(event) =>
              setValue({ minimumExcitement: event.target.value })
            }
          />
        </FlowField>
      </section>
    </div>
  );
}
