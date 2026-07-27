import type { IncomingMessage } from "node:http";
import { Readable } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ensureForgeRuntimeReady } from "./local-runtime";
import { createLocalOwnerSession } from "./local-owner-client";

vi.mock("./local-runtime", () => ({
  ensureForgeRuntimeReady: vi.fn().mockResolvedValue(undefined)
}));
vi.mock("./local-owner-client", () => ({
  createLocalOwnerSession: vi.fn().mockResolvedValue({
    cookie: "forge_session=fg_session_cookie",
    csrfToken: "fg_csrf_test",
    actorLabel: "Albert"
  })
}));

import {
  buildForgeBaseUrl,
  buildForgeWebAppUrl,
  canBootstrapOperatorSession,
  callConfiguredForgeApi,
  callForgeApi,
  expectForgeSuccess,
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

  it("never treats Tailscale reachability as local-owner authority", () => {
    expect(
      canBootstrapOperatorSession("https://forge.example.ts.net")
    ).toBe(false);
    expect(
      canBootstrapOperatorSession("http://100.64.10.20:4317")
    ).toBe(false);
    expect(
      canBootstrapOperatorSession("http://127.0.0.1:4317")
    ).toBe(true);
  });

  it("refuses to send remote bearer credentials over plain HTTP", async () => {
    await expect(
      callForgeApi({
        baseUrl: "http://100.64.10.20:4317",
        apiToken: "fg_remote_token",
        timeoutMs: 4000,
        method: "GET",
        path: "/api/v1/health"
      })
    ).rejects.toMatchObject({
      code: "forge_plugin_secure_transport_required",
      status: 400
    });
  });

  it.each(["authorization", "Authorization", "cookie", "dpop"])(
    "rejects caller-controlled %s credential headers before fetch",
    async (headerName) => {
      const fetchMock = vi.fn();
      vi.stubGlobal("fetch", fetchMock);

      await expect(
        callForgeApi({
          baseUrl: "https://forge.example.ts.net",
          timeoutMs: 4000,
          method: "GET",
          path: "/api/v1/health",
          extraHeaders: { [headerName]: "must-not-be-sent" }
        })
      ).rejects.toMatchObject({
        code: "forge_plugin_security_header_override_rejected",
        status: 400
      });
      expect(fetchMock).not.toHaveBeenCalled();
    }
  );

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
      new Response(
        JSON.stringify({
          ok: true,
          app: "forge",
          backend: "forge-node-runtime",
          runtime: { storageRoot: "/tmp/forge-api-client-test" }
        }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const config = {
      origin: "http://127.0.0.1",
      port: 4317,
      baseUrl: "http://127.0.0.1:4317",
      webAppUrl: "http://127.0.0.1:4317/forge/",
      portSource: "default",
      dataRoot: "/tmp/forge-api-client-test",
      apiToken: "fg_live_token",
      actorLabel: "aurel",
      injectBootstrapContext: true,
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
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" }
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await callForgeApi({
      baseUrl: "http://127.0.0.1:4317",
      dataRoot: "/tmp/forge-local-session-test",
      timeoutMs: 4000,
      method: "POST",
      path: "/api/v1/entities/search",
      body: { searches: [] }
    });

    expect(createLocalOwnerSession).toHaveBeenCalledWith(
      "http://127.0.0.1:4317",
      4000,
      "/tmp/forge-local-session-test"
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.toString()).toBe("http://127.0.0.1:4317/api/v1/entities/search");
    expect(init.headers).toMatchObject({
      cookie: "forge_session=fg_session_cookie",
      "x-forge-csrf": "fg_csrf_test",
      "x-forge-source": "openclaw",
      "x-forge-actor": "Albert",
      "content-type": "application/json"
    });
  });

  it("authenticates before rejecting a configured data-root mismatch", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            ok: true,
            app: "forge",
            backend: "forge-node-runtime",
            runtime: { storageRoot: "/tmp/another-forge-root" }
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" }
          }
        )
      )
    );
    await expect(
      callConfiguredForgeApi(
        {
          origin: "http://127.0.0.1",
          port: 44317,
          baseUrl: "http://127.0.0.1:44317",
          webAppUrl: "http://127.0.0.1:44317/forge/",
          portSource: "configured",
          dataRoot: "/tmp/expected-forge-root",
          apiToken: "fg_test",
          actorLabel: "test",
          injectBootstrapContext: true,
          timeoutMs: 4000
        },
        { method: "GET", path: "/api/v1/context" }
      )
    ).rejects.toMatchObject({
      code: "forge_plugin_data_root_mismatch",
      status: 409
    });
  });

  it("re-verifies Forge identity before retrying after local session renewal", async () => {
    const identityBody = {
      ok: true,
      app: "forge",
      backend: "forge-node-runtime",
      runtime: { storageRoot: "/tmp/forge-renewal-test" }
    };
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(JSON.stringify(identityBody), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: { code: "auth_required", message: "Session expired." }
          }),
          {
            status: 401,
            headers: { "content-type": "application/json" }
          }
        )
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify(identityBody), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true, entities: [] }), {
          status: 200,
          headers: { "content-type": "application/json" }
        })
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await callConfiguredForgeApi(
      {
        origin: "http://127.0.0.1",
        port: 45317,
        baseUrl: "http://127.0.0.1:45317",
        webAppUrl: "http://127.0.0.1:45317/forge/",
        portSource: "configured",
        dataRoot: "/tmp/forge-renewal-test",
        apiToken: "",
        actorLabel: "test",
        injectBootstrapContext: true,
        timeoutMs: 4000
      },
      { method: "GET", path: "/api/v1/entities" }
    );

    expect(result).toEqual({
      status: 200,
      body: { ok: true, entities: [] }
    });
    expect(
      fetchMock.mock.calls.map(([url]) => (url as URL).pathname)
    ).toEqual([
      "/api/v1/health",
      "/api/v1/entities",
      "/api/v1/health",
      "/api/v1/entities"
    ]);
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

  it("adds onboarding guidance when upstream auth_required comes from a raw route path", () => {
    expect(() =>
      expectForgeSuccess({
        status: 401,
        body: {
          ok: false,
          error: {
            code: "auth_required",
            message: "A token or operator session is required."
          }
        }
      })
    ).toThrow(
      /forge_get_agent_onboarding[\s\S]*forge_update_entities[\s\S]*patch\.checkIn/i
    );
  });
});
