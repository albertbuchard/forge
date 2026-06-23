import path from "node:path";
import { AbstractManager } from "../base.js";

export class StorageManager extends AbstractManager {
  readonly name = "StorageManager";

  constructor(private readonly cwd = process.cwd()) {
    super();
  }

  resolveDataDir() {
    return path.join(this.cwd, "data");
  }

  resolveClientDir() {
    return path.join(this.cwd, "dist");
  }
}
