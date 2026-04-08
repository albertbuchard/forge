import { AbstractManager } from "../base.js";
export class HealthManager extends AbstractManager {
    name = "HealthManager";
    summarize(input) {
        return input;
    }
}
