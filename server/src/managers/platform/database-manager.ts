import { AbstractManager } from "../base.js";
import { closeDatabase, configureDatabase, getDatabase } from "../../db.js";

export class DatabaseManager extends AbstractManager {
  readonly name = "DatabaseManager";

  configure(dataRoot?: string | null) {
    configureDatabase({ dataRoot: dataRoot ?? undefined });
  }

  getConnection() {
    return getDatabase();
  }

  close() {
    closeDatabase();
  }
}
