import { AbstractManager } from "../base.js";
import { closeDatabase, configureDatabase, getDatabase } from "../../db.js";
export class DatabaseManager extends AbstractManager {
    name = "DatabaseManager";
    configure(dataRoot) {
        configureDatabase({ dataRoot: dataRoot ?? undefined });
    }
    getConnection() {
        return getDatabase();
    }
    close() {
        closeDatabase();
    }
}
