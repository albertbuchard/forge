import { AbstractManager } from "../base.js";
import { initializeDatabase } from "../../db.js";
export class MigrationManager extends AbstractManager {
    name = "MigrationManager";
    async initialize() {
        await initializeDatabase();
    }
}
