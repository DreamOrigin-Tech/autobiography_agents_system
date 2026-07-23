import assert from "node:assert/strict";
import test from "node:test";

test("local API URL follows the hostname used to open the frontend", async () => {
  const apiModule = await import("./api.ts");
  const resolveApiBase = (apiModule as unknown as {
    resolveApiBase: (configuredUrl: string | undefined, pageUrl: string) => string;
  }).resolveApiBase;

  assert.equal(typeof resolveApiBase, "function");
  assert.equal(
    resolveApiBase("http://localhost:6986/api", "http://127.0.0.1:6985/"),
    "http://127.0.0.1:6986/api",
  );
  assert.equal(
    resolveApiBase("http://127.0.0.1:6986/api", "http://localhost:6985/"),
    "http://localhost:6986/api",
  );
  assert.equal(
    resolveApiBase("http://localhost:6986/api", "http://203.0.113.20:6985/"),
    "http://203.0.113.20:6986/api",
  );
});

test("API timeouts use a clear retryable message", async () => {
  const apiModule = await import("./api.ts");
  const requestFailureMessage = (apiModule as unknown as {
    requestFailureMessage: (error: unknown) => string;
  }).requestFailureMessage;

  assert.equal(typeof requestFailureMessage, "function");
  assert.equal(
    requestFailureMessage({ name: "AbortError" }),
    "服务响应超时，请稍后重试",
  );
});
