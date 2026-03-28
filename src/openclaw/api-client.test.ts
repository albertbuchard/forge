import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureForgeRuntimeReady } from "./local-runtime";

vi.mock("./local-runtime", () => ({
  ensureForgeRuntimeReady: vi.fn().mockResolvedValue(undefined)
}));

import {
  buildForgeBaseUrl,
  buildForgeWebAppUrl,
  callConfiguredForgeApi,
  callForgeApi,
  readJsonRequestBody,
  writePluginError,
  ForgePluginError
} from "./api-client";

function createResponseRecorder() {
  return {
    statusCode: 200,
    headers: {} as Record<string, string>,
    body: "",
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    end(chunk?: string) {
      this.body = chunk ?? "";
    }
  };
}

describe("openclaw api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("builds Forge API and UI URLs from origin plus port", () => {
    expect(buildForgeBaseUrl("http://127.0.0.1", 4317)).toBe("http://127.0.0.1:4317");
    expect(buildForgeWebAppUrl("http://127.0.0.1", 4317)).toBe("http://127.0.0.1:4317/forge/");
  });

  it("forwards Forge auth and provenance headers", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await callForgeApi({
      baseUrl: "http://127.0.0.1:4317",
      apiToken: "fg_live_token",
      actorLabel: "aurel",
      timeoutMs: 4000,
      method: "POST",
      path: "/api/v1/entities/create",
      body: { operations: [] },
      idempotencyKey: "abc-123"
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("http://127.0.0.1:4317/api/v1/entities/create");
    expect(init.method).toBe("POST");
    expect(init.headers).toMatchObject({
      authorization: "Bearer fg_live_token",
      "x-forge-source": "openclaw",
      "x-forge-actor": "aurel",
      "idempotency-key": "abc-123",
      "content-type": "application/json"
    });
  });

  it("ensures the local Forge runtime before configured requests", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const config = {
      origin: "http://127.0.0.1",
      port: 4317,
      baseUrl: "http://127.0.0.1:4317",
      webAppUrl: "http://127.0.0.1:4317/forge/",
      dataRoot: "",
      apiToken: "fg_live_token",
      actorLabel: "aurel",
      timeoutMs: 4000
    } as const;

    await callConfiguredForgeApi(config, {
      method: "GET",
      path: "/api/v1/health"
    });

    expect(ensureForgeRuntimeReady).toHaveBeenCalledWith(config);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("bootstraps a local operator session when no apiToken is configured", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ session: { id: "ses_local" } }), {
          status: 200,
          headers: {
            "content-type": "application/json",
            "set-cookie": "forge_operator_session=fg_session_cookie; Path=/; HttpOnly"
          }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    await callForgeApi({
      baseUrl: "http://127.0.0.1:4317",
      actorLabel: "aurel",
      timeoutMs: 4000,
      method: "POST",
      path: "/api/v1/entities/search",
      body: { searches: [] }
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [bootstrapUrl] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(bootstrapUrl.toString()).toBe("http://127.0.0.1:4317/api/v1/auth/operator-session");

    const [url, init] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(url.toString()).toBe("http://127.0.0.1:4317/api/v1/entities/search");
    expect(init.headers).toMatchObject({
      cookie: "forge_operator_session=fg_session_cookie",
      "x-forge-source": "openclaw",
      "x-forge-actor": "aurel",
      "content-type": "application/json"
    });
  });

  it("parses JSON request bodies and supports empty-object writes", async () => {
    const request = Readable.from([JSON.stringify({ query: "deep work" })]) as Readable & {
      headers: Record<string, string>;
      method: string;
      url: string;
    };
    request.headers = {};
    request.method = "POST";
    request.url = "/forge/v1/entities/search";

    await expect(readJsonRequestBody(request as unknown as IncomingMessage, { emptyObject: true })).resolves.toEqual({
      query: "deep work"
    });

    const emptyRequest = Readable.from([]) as Readable & {
      headers: Record<string, string>;
      method: string;
      url: string;
    };
    emptyRequest.headers = {};
    emptyRequest.method = "POST";
    emptyRequest.url = "/forge/v1/entities/search";

    await expect(readJsonRequestBody(emptyRequest as unknown as IncomingMessage, { emptyObject: true })).resolves.toEqual({});
  });

  it("serializes plugin-owned errors into machine-readable JSON", () => {
    const response = createResponseRecorder();
    writePluginError(response as never, new ForgePluginError(401, "forge_plugin_token_required", "Missing token"));

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({
      ok: false,
      error: {
        code: "forge_plugin_token_required",
        message: "Missing token"
      }
    });
  });
});
