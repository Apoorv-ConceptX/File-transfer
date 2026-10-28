import { test } from "node:test";
import assert from "node:assert/strict";
import {
  driveId,
  extensions,
  included,
  matches,
  targetPath,
  csvCell,
  renamed,
  jobSchema,
} from "../src/lib/rules";
import { encrypt, decrypt } from "../src/lib/crypto";
import type { JobConfig } from "../src/lib/types";
export const config: JobConfig = {
  title: "Test",
  kind: "copy",
  sources: ["source-folder-id"],
  destination: "destination-folder-id",
  recursive: true,
  includeExtensions: [],
  excludeExtensions: [],
  nameIncludes: "",
  excludedFolders: [],
  layout: "preserve",
  conflicts: "skip",
  selection: [],
  matchBy: "filename",
  matchMode: "exact",
  batchSize: 400,
};
test("accepts Drive links and IDs but rejects local paths and hostile hosts", () => {
  assert.equal(
    driveId(
      "https://drive.google.com/drive/u/0/folders/1234567890abc?usp=sharing",
    ),
    "1234567890abc",
  );
  assert.equal(
    driveId("https://drive.google.com/file/d/1234567890abc/view"),
    "1234567890abc",
  );
  assert.equal(
    driveId("https://drive.google.com/open?id=1234567890abc"),
    "1234567890abc",
  );
  assert.throws(() => driveId("/content/drive/data"));
  assert.throws(() => driveId("https://evil.example/folders/1234567890abc"));
});
test("all file types, mixed extensions, compound extensions and exclusions", () => {
  assert.equal(included("anything.unrecognised", config), true);
  const c = {
    ...config,
    includeExtensions: extensions("*.JPG, .json, ZIP;tar.gz"),
    excludeExtensions: ["json"],
  };
  assert.equal(included("photo.JPG", c), true);
  assert.equal(included("dataset.zip", c), true);
  assert.equal(included("data.tar.gz", c), true);
  assert.equal(included("data.json", c), false);
  assert.equal(included("photo.jpg.exe", c), false);
});
test("exact, stem and bounded equipment matching do not overmatch IDs", () => {
  const row = { value: "C:/old/ABC.jpg", structure: "", batch: "" };
  assert.equal(matches({ id: "1", name: "abc.JPG" }, row, config), true);
  assert.equal(
    matches({ id: "1", name: "abc.jpeg" }, row, {
      ...config,
      matchMode: "stem",
    }),
    true,
  );
  assert.equal(
    matches(
      { id: "1", name: "pole_123_Dx.jpg" },
      { ...row, value: "123" },
      { ...config, matchBy: "equipment" },
    ),
    true,
  );
  assert.equal(
    matches(
      { id: "1", name: "pole_1234_Dx.jpg" },
      { ...row, value: "123" },
      { ...config, matchBy: "equipment" },
    ),
    false,
  );
});
test("batch assignment counts unique structures, keeps supplied batches, sanitizes paths", () => {
  const selection = [
    { value: "a", structure: "A", batch: "" },
    { value: "b", structure: "A", batch: "" },
    { value: "c", structure: "B", batch: "" },
  ];
  const c = { ...config, layout: "batch" as const, batchSize: 1, selection };
  assert.equal(targetPath(c, "", selection[2]), "Batch 2/B");
  assert.equal(
    targetPath(c, "", { ...selection[0], batch: "Custom/Batch" }),
    "Custom_Batch/A",
  );
  assert.equal(renamed("x.json", "abcdef"), "x__abcdef.json");
});
test("requires destination and structure mappings before job creation", () => {
  assert.equal(
    jobSchema.safeParse({ ...config, destination: "" }).success,
    false,
  );
  assert.equal(
    jobSchema.safeParse({ ...config, layout: "structure" }).success,
    false,
  );
  assert.equal(
    jobSchema.safeParse({ ...config, kind: "inventory", destination: "" })
      .success,
    true,
  );
});
test("CSV quoting neutralises spreadsheet formula injection", () => {
  assert.equal(csvCell("=1+1"), '"\'=1+1"');
  assert.equal(csvCell('a,"b"'), '"a,""b"""');
});
test("OAuth token encryption detects tampering", () => {
  process.env.TOKEN_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
  const sealed = encrypt("refresh-token");
  assert.equal(decrypt(sealed), "refresh-token");
  const parts = sealed.split(".");
  parts[1] = Buffer.alloc(16, 0).toString("base64url");
  assert.throws(() => decrypt(parts.join(".")));
});
