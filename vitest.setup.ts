import "@testing-library/jest-dom/vitest";

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
