import { AbstractManager } from "../base.js";
import { runInTransaction } from "../../db.js";
export class TransactionManager extends AbstractManager {
    name = "TransactionManager";
    run(operation) {
        return runInTransaction(operation);
    }
}
