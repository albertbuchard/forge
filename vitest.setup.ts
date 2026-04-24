import "@testing-library/jest-dom/vitest";

const testGlobal = globalThis as Record<string, unknown>;

testGlobal.WebGLRenderingContext ??= class WebGLRenderingContext {};
testGlobal.WebGL2RenderingContext ??= class WebGL2RenderingContext {};
