import { seedDemoDataIntoRuntime } from "./demo-data.js";
const explicitDataRoot = process.argv[2];
try {
    const summary = await seedDemoDataIntoRuntime(explicitDataRoot);
    console.log(`Seeded Forge demo data into ${summary.databasePath}`);
    console.log(`Counts: goals=${summary.counts.goals}, projects=${summary.counts.projects}, tasks=${summary.counts.tasks}, task_runs=${summary.counts.task_runs}`);
}
catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
}
