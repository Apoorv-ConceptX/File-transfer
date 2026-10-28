import { test } from "node:test";
import assert from "node:assert/strict";
import { Drive, DriveError } from "../src/lib/drive";
import { FOLDER } from "../src/lib/types";
import { allowedEmail } from "../src/lib/config";
test("Drive transport supports Shared Drives, pagination and server-side copies", async () => {
  const original = globalThis.fetch;
  const calls: { url: URL; init?: RequestInit }[] = [];
  globalThis.fetch = async (input, init) => {
    calls.push({ url: new URL(String(input)), init });
    return new Response(
      JSON.stringify({ files: [], id: "copy-id", name: "dataset.zip" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  };
  try {
    const drive = new Drive("test-token");
    await drive.list("shared-root", "cursor");
    await drive.copy("source-id", "dataset.zip", "destination-id", "marker");
    assert.equal(
      calls[0].url.searchParams.get("includeItemsFromAllDrives"),
      "true",
    );
    assert.equal(calls[0].url.searchParams.get("supportsAllDrives"), "true");
    assert.equal(calls[0].url.searchParams.get("pageToken"), "cursor");
    assert.equal(calls[1].url.pathname, "/drive/v3/files/source-id/copy");
    const body = JSON.parse(String(calls[1].init!.body));
    assert.deepEqual(body.parents, ["destination-id"]);
    assert.equal(body.appProperties.toolkit_item, "marker");
  } finally {
    globalThis.fetch = original;
  }
});
test("Drive distinguishes transient throttling from permanent permission failures", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: { errors: [{ reason: "userRateLimitExceeded" }] },
        }),
        { status: 403 },
      );
    await assert.rejects(
      () => new Drive("token").get("id"),
      (e) => e instanceof DriveError && e.transient,
    );
    globalThis.fetch = async () =>
      new Response(
        JSON.stringify({
          error: { errors: [{ reason: "insufficientPermissions" }] },
        }),
        { status: 403 },
      );
    await assert.rejects(
      () => new Drive("token").get("id"),
      (e) => e instanceof DriveError && !e.transient,
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("destination guard rejects a nested destination, same source and unwritable folder", async () => {
  const drive = new Drive("token");
  const source = { id: "source", name: "Source", mimeType: FOLDER };
  drive.get = async (id: string) =>
    id === "dest"
      ? { id, name: "Destination", mimeType: FOLDER, parents: ["source"] }
      : source;
  await assert.rejects(
    () =>
      drive.ensureSafeDestination([source], {
        id: "dest",
        name: "Destination",
        mimeType: FOLDER,
      }),
    /inside/,
  );
  await assert.rejects(
    () => drive.ensureSafeDestination([source], source),
    /source/,
  );
  await assert.rejects(
    () =>
      drive.ensureSafeDestination([source], {
        id: "dest",
        name: "Destination",
        mimeType: FOLDER,
        capabilities: { canAddChildren: false },
      }),
    /writable/,
  );
});
test("email allowlist is closed by default and matches whole verified addresses", () => {
  const old = process.env.ALLOWED_EMAILS;
  try {
    process.env.ALLOWED_EMAILS = "";
    assert.equal(allowedEmail("person@example.com"), false);
    process.env.ALLOWED_EMAILS = " Person@Example.com, another@example.com ";
    assert.equal(allowedEmail("person@example.com"), true);
    assert.equal(allowedEmail("xperson@example.com"), false);
  } finally {
    if (old === undefined) delete process.env.ALLOWED_EMAILS;
    else process.env.ALLOWED_EMAILS = old;
  }
});
