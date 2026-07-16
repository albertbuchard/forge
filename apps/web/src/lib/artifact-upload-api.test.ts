import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";
import { uploadArtifact } from "./api";
import type {
  ArtifactMetadataPatchInput,
  ArtifactTrustPatchInput
} from "./types";

type FakeXhrPlan = {
  body: unknown;
  hold?: boolean;
  progress?: number;
  status: number;
  statusText: string;
};

class FakeArtifactUploadXhr {
  static plans: FakeXhrPlan[] = [];
  static requests: FakeArtifactUploadXhr[] = [];

  method = "";
  url = "";
  withCredentials = false;
  status = 0;
  statusText = "";
  responseText = "";
  requestBody: Document | XMLHttpRequestBodyInit | null = null;
  readonly requestHeaders = new Map<string, string>();
  readonly upload: {
    onprogress: ((event: ProgressEvent) => void) | null;
  } = { onprogress: null };
  onabort: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onload: (() => void) | null = null;

  constructor() {
    FakeArtifactUploadXhr.requests.push(this);
  }

  open(method: string, url: string) {
    this.method = method;
    this.url = url;
  }

  setRequestHeader(name: string, value: string) {
    this.requestHeaders.set(name.toLowerCase(), value);
  }

  getResponseHeader(name: string) {
    return name.toLowerCase() === "content-type" ? "application/json" : null;
  }

  send(body: Document | XMLHttpRequestBodyInit | null) {
    this.requestBody = body;
    const plan = FakeArtifactUploadXhr.plans.shift();
    if (!plan) {
      throw new Error("Missing fake Artifact upload response plan.");
    }
    this.status = plan.status;
    this.statusText = plan.statusText;
    this.responseText = JSON.stringify(plan.body);
    if (typeof plan.progress === "number") {
      this.upload.onprogress?.({
        lengthComputable: true,
        loaded: plan.progress,
        total: 100
      } as ProgressEvent);
    }
    if (!plan.hold) {
      queueMicrotask(() => this.onload?.());
    }
  }

  abort() {
    this.onabort?.();
  }
}

function installFakeArtifactUploadXhr(...plans: FakeXhrPlan[]) {
  FakeArtifactUploadXhr.plans = [...plans];
  FakeArtifactUploadXhr.requests = [];
  vi.stubGlobal(
    "XMLHttpRequest",
    FakeArtifactUploadXhr as unknown as typeof XMLHttpRequest
  );
}

const uploadInput = {
  idempotencyKey: "artifact-api-client-retry-1",
  originalFileName: "evidence.txt",
  contentBase64: "ZXZpZGVuY2U="
};

describe("Artifact upload API client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    FakeArtifactUploadXhr.plans = [];
    FakeArtifactUploadXhr.requests = [];
  });

  it("keeps trust fields out of the ordinary metadata patch contract", () => {
    expectTypeOf<
      Extract<
        keyof ArtifactMetadataPatchInput,
        "artifactState" | "downloadPolicy"
      >
    >().toEqualTypeOf<never>();
    expectTypeOf<ArtifactTrustPatchInput>()
      .toHaveProperty("artifactState")
      .toEqualTypeOf<ArtifactTrustPatchInput["artifactState"]>();
    expectTypeOf<ArtifactTrustPatchInput>()
      .toHaveProperty("downloadPolicy")
      .toEqualTypeOf<ArtifactTrustPatchInput["downloadPolicy"]>();
  });

  it("reports network progress and sends the stable retry key", async () => {
    installFakeArtifactUploadXhr({
      status: 201,
      statusText: "Created",
      progress: 40,
      body: { artifact: { id: "artifact_1" } }
    });
    const progress: number[] = [];

    const response = await uploadArtifact(uploadInput, {
      idempotencyKey: uploadInput.idempotencyKey,
      onProgress: (percentage) => progress.push(percentage)
    });

    expect(response.artifact.id).toBe("artifact_1");
    expect(progress).toEqual([0, 40, 100]);
    const request = FakeArtifactUploadXhr.requests[0];
    expect(request?.method).toBe("POST");
    expect(request?.url).toMatch(/\/api\/v1\/artifacts$/);
    expect(request?.withCredentials).toBe(true);
    expect(request?.requestHeaders.get("idempotency-key")).toBe(
      uploadInput.idempotencyKey
    );
    expect(request?.requestHeaders.get("x-forge-source")).toBe("ui");
    expect(JSON.parse(String(request?.requestBody))).toMatchObject(uploadInput);
  });

  it("aborts one in-flight request through its AbortSignal", async () => {
    installFakeArtifactUploadXhr({
      status: 201,
      statusText: "Created",
      hold: true,
      body: { artifact: { id: "artifact_never_returned" } }
    });
    const controller = new AbortController();
    const request = uploadArtifact(uploadInput, {
      signal: controller.signal,
      onProgress: vi.fn()
    });

    controller.abort();

    await expect(request).rejects.toMatchObject({ name: "AbortError" });
  });

  it("retries once after local session bootstrap without changing identity", async () => {
    installFakeArtifactUploadXhr(
      {
        status: 401,
        statusText: "Unauthorized",
        body: { code: "auth_required", error: "Authentication required" }
      },
      {
        status: 200,
        statusText: "OK",
        body: { artifact: { id: "artifact_replayed" } }
      }
    );
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({ session: { id: "operator_session_local" } }),
        {
          status: 200,
          headers: { "content-type": "application/json" }
        }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await uploadArtifact(uploadInput, {
      idempotencyKey: uploadInput.idempotencyKey,
      onProgress: vi.fn()
    });

    expect(response.artifact.id).toBe("artifact_replayed");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(String(fetchMock.mock.calls[0]?.[0])).toMatch(
      /\/api\/v1\/auth\/operator-session$/
    );
    expect(FakeArtifactUploadXhr.requests).toHaveLength(2);
    for (const request of FakeArtifactUploadXhr.requests) {
      expect(request.requestHeaders.get("idempotency-key")).toBe(
        uploadInput.idempotencyKey
      );
      expect(JSON.parse(String(request.requestBody))).toEqual(uploadInput);
    }
  });
});
