import assert from "node:assert/strict";
import test from "node:test";
import { HttpError } from "./errors.js";
import {
  fetchWikiIngestUrl,
  isPublicWikiIngestAddress,
  parseWikiIngestUrl,
  resolveWikiIngestUrlTarget,
  type WikiUrlFetchDependencies,
  type WikiUrlFetchResponse
} from "./services/wiki-url-fetch.js";

const publicLookup: NonNullable<
  WikiUrlFetchDependencies["lookup"]
> = async () => [{ address: "93.184.216.34", family: 4 }];

function response(
  statusCode: number,
  headers: WikiUrlFetchResponse["headers"],
  chunks: string[] = []
): WikiUrlFetchResponse {
  return {
    statusCode,
    headers,
    body: (async function* () {
      for (const chunk of chunks) {
        yield Buffer.from(chunk);
      }
    })(),
    close() {}
  };
}

test("wiki URL policy rejects non-HTTP schemes and embedded credentials", () => {
  assert.throws(() => parseWikiIngestUrl("file:///etc/passwd"), HttpError);
  assert.throws(
    () => parseWikiIngestUrl("https://user:secret@example.com/private"),
    HttpError
  );
});

test("wiki URL policy blocks private, loopback, link-local, mapped, and reserved addresses", () => {
  for (const address of [
    "0.0.0.0",
    "10.0.0.7",
    "100.64.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.31.2.4",
    "192.168.1.1",
    "198.18.0.1",
    "203.0.113.10",
    "224.0.0.1",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "ff02::1",
    "2001:db8::1"
  ]) {
    assert.equal(isPublicWikiIngestAddress(address), false, address);
  }
  assert.equal(isPublicWikiIngestAddress("93.184.216.34"), true);
  assert.equal(
    isPublicWikiIngestAddress("2606:2800:220:1:248:1893:25c8:1946"),
    true
  );
});

test("wiki URL policy rejects a hostname when any DNS answer is non-public", async () => {
  await assert.rejects(
    resolveWikiIngestUrlTarget("https://example.com/source", {
      lookup: async () => [
        { address: "93.184.216.34", family: 4 },
        { address: "127.0.0.1", family: 4 }
      ]
    }),
    /cannot access private/
  );
});

test("wiki URL policy applies the timeout to DNS resolution", async () => {
  await assert.rejects(
    resolveWikiIngestUrlTarget(
      "https://slow-dns.example/source",
      {
        lookup: () => new Promise(() => undefined)
      },
      5
    ),
    /DNS lookup timed out/
  );
});

test("wiki URL fetch revalidates redirect DNS and blocks a public-to-private pivot", async () => {
  const requested: string[] = [];
  await assert.rejects(
    fetchWikiIngestUrl("https://public.example/start", {
      dependencies: {
        lookup: async (hostname) =>
          hostname === "public.example"
            ? [{ address: "93.184.216.34", family: 4 }]
            : [{ address: "169.254.169.254", family: 4 }],
        request: async ({ url }) => {
          requested.push(url.href);
          return response(302, {
            location: "http://metadata.internal/latest"
          });
        }
      }
    }),
    /cannot access private/
  );
  assert.deepEqual(requested, ["https://public.example/start"]);
});

test("wiki URL fetch enforces redirect, byte, and content-type limits", async (t) => {
  await t.test("redirect cap", async () => {
    await assert.rejects(
      fetchWikiIngestUrl("https://example.com/0", {
        maxRedirects: 1,
        dependencies: {
          lookup: publicLookup,
          request: async ({ url }) =>
            response(302, { location: `${Number(url.pathname.slice(1)) + 1}` })
        }
      }),
      /at most 1 redirects/
    );
  });
  await t.test("streamed byte cap", async () => {
    await assert.rejects(
      fetchWikiIngestUrl("https://example.com/large", {
        maxBytes: 5,
        dependencies: {
          lookup: publicLookup,
          request: async () =>
            response(200, { "content-type": "text/plain" }, ["123", "456"])
        }
      }),
      /limited to 5 bytes/
    );
  });
  await t.test("content type allowlist", async () => {
    await assert.rejects(
      fetchWikiIngestUrl("https://example.com/binary", {
        dependencies: {
          lookup: publicLookup,
          request: async () =>
            response(200, { "content-type": "application/octet-stream" }, [
              "payload"
            ])
        }
      }),
      /accepts text, JSON, XML, PDF/
    );
  });
});

test("wiki URL fetch returns allowed content from the DNS-pinned request", async () => {
  const result = await fetchWikiIngestUrl("https://example.com/article", {
    dependencies: {
      lookup: publicLookup,
      request: async ({ address }) => {
        assert.equal(address.address, "93.184.216.34");
        return response(
          200,
          { "content-type": "text/markdown; charset=utf-8" },
          ["# Safe source"]
        );
      }
    }
  });
  assert.equal(result.mimeType, "text/markdown");
  assert.equal(result.payload.toString("utf8"), "# Safe source");
});

test("wiki URL fetch aborts a request that exceeds the per-hop timeout", async () => {
  await assert.rejects(
    fetchWikiIngestUrl("https://example.com/slow", {
      timeoutMs: 5,
      dependencies: {
        lookup: publicLookup,
        request: ({ signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener(
              "abort",
              () => reject(new Error("request aborted")),
              { once: true }
            );
          })
      }
    }),
    /timed out/
  );
});
