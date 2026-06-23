declare module "adm-zip" {
  export type AdmZipEntry = {
    entryName: string;
    isDirectory: boolean;
    getData(): Buffer;
  };

  export default class AdmZip {
    constructor(filePath?: string | Buffer, _options?: unknown);
    addLocalFile(filePath: string, zipPath?: string, zipName?: string): void;
    addFile(entryName: string, content: Buffer): void;
    addLocalFolder(localPath: string, zipPath?: string): void;
    extractAllTo(targetPath: string, overwrite?: boolean): void;
    getEntries(): AdmZipEntry[];
    toBuffer(): Buffer;
    writeZip(targetPath: string): void;
  }
}
