import "@testing-library/jest-dom/vitest";

class MemoryStorage implements Storage {
  private values = new Map<string, string>();

  get length() {
    return this.values.size;
  }

  clear() {
    this.values.clear();
  }

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  key(index: number) {
    return Array.from(this.values.keys())[index] ?? null;
  }

  removeItem(key: string) {
    this.values.delete(key);
  }

  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
}

for (const storageKey of ["localStorage", "sessionStorage"] as const) {
  if (!(storageKey in globalThis) || globalThis[storageKey] == null) {
    Object.defineProperty(globalThis, storageKey, {
      value: new MemoryStorage(),
      writable: true,
      configurable: true
    });
  }
}

class MockWebGLRenderingContext {}
class MockWebGL2RenderingContext extends MockWebGLRenderingContext {}

if (!("WebGLRenderingContext" in globalThis)) {
  Object.defineProperty(globalThis, "WebGLRenderingContext", {
    value: MockWebGLRenderingContext,
    writable: true,
    configurable: true
  });
}
if (!("WebGL2RenderingContext" in globalThis)) {
  Object.defineProperty(globalThis, "WebGL2RenderingContext", {
    value: MockWebGL2RenderingContext,
    writable: true,
    configurable: true
  });
}

const originalGetContext = HTMLCanvasElement.prototype.getContext;
HTMLCanvasElement.prototype.getContext = (function getContext(
  this: HTMLCanvasElement,
  contextId: string,
  options?: unknown
) {
  if (contextId === "webgl2") {
    return new MockWebGL2RenderingContext() as ReturnType<
      typeof HTMLCanvasElement.prototype.getContext
    >;
  }
  if (contextId === "webgl" || contextId === "experimental-webgl") {
    return new MockWebGLRenderingContext() as ReturnType<
      typeof HTMLCanvasElement.prototype.getContext
    >;
  }
  return originalGetContext.call(
    this,
    contextId as Parameters<typeof originalGetContext>[0],
    options as Parameters<typeof originalGetContext>[1]
  );
}) as typeof HTMLCanvasElement.prototype.getContext;
