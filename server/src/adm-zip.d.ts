declare module "adm-zip" {
  export type AdmZipEntry = {
    entryName: string;
    isDirectory: boolean;
    getData(): Buffer;
  };

  export default class AdmZip {
    constructor(filePath?: string, _options?: unknown);
    getEntries(): AdmZipEntry[];
  }
}
