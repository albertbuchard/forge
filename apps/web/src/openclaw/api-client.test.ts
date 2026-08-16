import type { IncomingMessage } from "node:http";
import { createHash } from "node:crypto";
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
  callConfiguredForgeAgentMessageAudio,
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

  it("downloads only the scoped Agent Message voice route and verifies its identity", async () => {
    const bytes = new TextEncoder().encode("RIFF scoped agent voice");
    const contentSha256 = createHash("sha256").update(bytes).digest("hex");
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            app: "forge",
            backend: "forge-node-runtime",
            runtime: { storageRoot: "/tmp/forge-agent-audio-valid" }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(bytes, {
          status: 200,
          headers: {
            "content-type": "audio/wav",
            "content-length": String(bytes.byteLength),
            "x-forge-content-sha256": contentSha256,
            "x-forge-artifact-id": "artifact_voice_1"
          }
        })
      );
    vi.stubGlobal("fetch", fetchMock);
    const config = {
      origin: "http://127.0.0.1",
      port: 46317,
      baseUrl: "http://127.0.0.1:46317",
      webAppUrl: "http://127.0.0.1:46317/forge/",
      portSource: "configured",
      dataRoot: "/tmp/forge-agent-audio-valid",
      apiToken: "fg_agent_messages_token",
      actorLabel: "Mailbox agent",
      injectBootstrapContext: true,
      timeoutMs: 4_000
    } as const;

    const result = await callConfiguredForgeAgentMessageAudio(config, {
      path: "/api/v1/agent-messages/message_1/voice",
      body: { leaseSecret: "a".repeat(43), claimGeneration: 2 }
    });

    expect(result.artifactId).toBe("artifact_voice_1");
    expect(result.contentSha256).toBe(contentSha256);
    expect(result.mimeType).toBe("audio/wav");
    expect(Array.from(result.bytes)).toEqual(Array.from(bytes));
    const [audioUrl, audioInit] = fetchMock.mock.calls[1] as [URL, RequestInit];
    expect(audioUrl.pathname).toBe("/api/v1/agent-messages/message_1/voice");
    expect(audioInit.headers).toMatchObject({
      authorization: "Bearer fg_agent_messages_token",
      accept: expect.stringContaining("audio/wav")
    });
    expect(JSON.parse(String(audioInit.body))).toEqual({
      leaseSecret: "a".repeat(43),
      claimGeneration: 2
    });
  });

  it("rejects generic paths and over-limit or hash-mismatched Agent Message audio", async () => {
    const baseConfig = {
      origin: "http://127.0.0.1",
      port: 47317,
      baseUrl: "http://127.0.0.1:47317",
      webAppUrl: "http://127.0.0.1:47317/forge/",
      portSource: "configured",
      dataRoot: "/tmp/forge-agent-audio-invalid",
      apiToken: "fg_agent_messages_token",
      actorLabel: "Mailbox agent",
      injectBootstrapContext: true,
      timeoutMs: 4_000
    } as const;
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      callConfiguredForgeAgentMessageAudio(baseConfig, {
        path: "/api/v1/artifacts/artifact_1/download",
        body: { leaseSecret: "a".repeat(43), claimGeneration: 1 }
      })
    ).rejects.toMatchObject({ code: "forge_agent_message_audio_path_rejected" });
    expect(fetchMock).not.toHaveBeenCalled();

    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            app: "forge",
            backend: "forge-node-runtime",
            runtime: { storageRoot: baseConfig.dataRoot }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1]), {
          status: 200,
          headers: {
            "content-type": "audio/wav",
            "content-length": String(25 * 1024 * 1024 + 1),
            "x-forge-content-sha256": "a".repeat(64),
            "x-forge-artifact-id": "artifact_voice_over_limit"
          }
        })
      );
    await expect(
      callConfiguredForgeAgentMessageAudio(baseConfig, {
        path: "/api/v1/agent-messages/message_2/voice",
        body: { leaseSecret: "b".repeat(43), claimGeneration: 1 }
      })
    ).rejects.toMatchObject({
      code: "forge_agent_message_audio_length_invalid"
    });

    const hashConfig = {
      ...baseConfig,
      port: 48317,
      baseUrl: "http://127.0.0.1:48317",
      webAppUrl: "http://127.0.0.1:48317/forge/",
      dataRoot: "/tmp/forge-agent-audio-hash"
    } as const;
    fetchMock
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            ok: true,
            app: "forge",
            backend: "forge-node-runtime",
            runtime: { storageRoot: hashConfig.dataRoot }
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
      )
      .mockResolvedValueOnce(
        new Response(new Uint8Array([1, 2, 3]), {
          status: 200,
          headers: {
            "content-type": "audio/wav",
            "content-length": "3",
            "x-forge-content-sha256": "c".repeat(64),
            "x-forge-artifact-id": "artifact_voice_hash"
          }
        })
      );
    await expect(
      callConfiguredForgeAgentMessageAudio(hashConfig, {
        path: "/api/v1/agent-messages/message_3/voice",
        body: { leaseSecret: "c".repeat(43), claimGeneration: 1 }
      })
    ).rejects.toMatchObject({ code: "forge_agent_message_audio_hash_mismatch" });
  });
});
