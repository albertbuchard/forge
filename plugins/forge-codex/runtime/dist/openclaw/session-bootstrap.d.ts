import { type ForgePluginConfig } from "./api-client.js";
import type { ForgePluginRegistrationApi } from "./plugin-sdk-types.js";
type ForgeGoalRecord = {
    id: string;
    title: string;
    description?: string | null;
    status?: string;
    horizon?: string | null;
};
type ForgeProjectRecord = {
    id: string;
    title: string;
    description?: string | null;
    status?: string;
    goalId?: string | null;
    goalTitle?: string | null;
};
type ForgeTaskRecord = {
    id: string;
    title: string;
    description?: string | null;
    status?: string;
    priority?: string;
    dueDate?: string | null;
    projectId?: string | null;
    projectTitle?: string | null;
    goalId?: string | null;
    goalTitle?: string | null;
};
type ForgeHabitRecord = {
    id: string;
    title: string;
    description?: string | null;
    polarity?: string;
    frequency?: string | null;
};
type ForgeStrategyRecord = {
    id: string;
    title: string;
    overview?: string | null;
    status?: string | null;
    isLocked?: boolean;
};
type ForgeWikiPageRecord = {
    id: string;
    slug: string;
    title: string;
    kind?: string;
    parentSlug?: string | null;
    summary?: string | null;
    contentPlain?: string | null;
};
type ForgeOperatorContext = {
    generatedAt?: string;
    activeProjects?: ForgeProjectRecord[];
    focusTasks?: ForgeTaskRecord[];
    dueHabits?: ForgeHabitRecord[];
    recommendedNextTask?: ForgeTaskRecord | null;
};
type ForgeOperatorOverview = {
    generatedAt?: string;
    warnings?: string[];
    operator?: ForgeOperatorContext | null;
};
type ForgeBootstrapPolicy = {
    mode: "disabled" | "active_only" | "scoped" | "full";
    goalsLimit: number;
    projectsLimit: number;
    tasksLimit: number;
    habitsLimit: number;
    strategiesLimit: number;
    peoplePageLimit: number;
    includePeoplePages: boolean;
};
type ForgeSessionBootstrapPayload = {
    bootstrapPolicy: ForgeBootstrapPolicy;
    overview: ForgeOperatorOverview | null;
    goals: ForgeGoalRecord[];
    projects: ForgeProjectRecord[];
    tasks: ForgeTaskRecord[];
    habits: ForgeHabitRecord[];
    strategies: ForgeStrategyRecord[];
    peoplePages: ForgeWikiPageRecord[];
};
export declare function listPeopleBranchPages(pages: ForgeWikiPageRecord[]): ForgeWikiPageRecord[];
export declare function buildForgeSessionBootstrapContext(payload: ForgeSessionBootstrapPayload): string;
export declare function buildLiveForgeSessionBootstrapContext(config: ForgePluginConfig): Promise<string>;
export declare function registerForgeSessionBootstrapHook(api: ForgePluginRegistrationApi, config: ForgePluginConfig): void;
export {};
