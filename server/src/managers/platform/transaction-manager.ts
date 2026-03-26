import { AbstractManager } from "../base.js";
import { runInTransaction } from "../../db.js";

export class TransactionManager extends AbstractManager {
  readonly name = "TransactionManager";

  run<T>(operation: () => T): T {
    return runInTransaction(operation);
  }
}
