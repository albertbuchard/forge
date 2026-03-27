import path from "node:path";
import { AbstractManager } from "../base.js";
export class StorageManager extends AbstractManager {
    cwd;
    name = "StorageManager";
    constructor(cwd = process.cwd()) {
        super();
        this.cwd = cwd;
    }
    resolveDataDir() {
        return path.join(this.cwd, "data");
    }
    resolveClientDir() {
        return path.join(this.cwd, "dist");
    }
}
