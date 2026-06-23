export function installMockDate(isoTimestamp: string) {
  const RealDate = Date;
  const fixedNow = new RealDate(isoTimestamp);

  class MockDate extends RealDate {
    constructor();
    constructor(value: string | number | Date);
    constructor(
      year: number,
      monthIndex: number,
      date?: number,
      hours?: number,
      minutes?: number,
      seconds?: number,
      ms?: number
    );
    constructor(...value: unknown[]) {
      if (value.length === 0) {
        super(fixedNow.toISOString());
        return;
      }
      if (value.length === 1) {
        super(value[0] as string | number | Date);
        return;
      }
      super(
        value[0] as number,
        value[1] as number,
        value[2] as number | undefined,
        value[3] as number | undefined,
        value[4] as number | undefined,
        value[5] as number | undefined,
        value[6] as number | undefined
      );
    }

    static now() {
      return fixedNow.getTime();
    }

    static parse(value: string) {
      return RealDate.parse(value);
    }

    static UTC(...value: Parameters<typeof Date.UTC>) {
      return RealDate.UTC(...value);
    }
  }

  globalThis.Date = MockDate as DateConstructor;
  return () => {
    globalThis.Date = RealDate;
  };
}
