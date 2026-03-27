import { AbstractManager } from "../base.js";
export class EventBusManager extends AbstractManager {
    name = "EventBusManager";
    publish(_event) {
        return;
    }
}
