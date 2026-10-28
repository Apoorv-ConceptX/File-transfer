import { z } from "zod";
import type { JobConfig, Selection } from "./types";
export const jobSchema = z
  .object({
    title: z.string().trim().min(1).max(120),
    kind: z.enum(["copy", "metadata", "inventory"]),
    sources: z.array(z.string().min(1).max(500)).min(1).max(20),
    destination: z.string().max(500).default(""),
    recursive: z.boolean(),
    includeExtensions: z.array(z.string().max(30)).max(100),
    excludeExtensions: z.array(z.string().max(30)).max(100),
    nameIncludes: z.string().max(200),
    excludedFolders: z.array(z.string().max(200)).max(100),
    layout: z.enum(["preserve", "flat", "structure", "batch"]),
    conflicts: z.enum(["skip", "rename", "error"]),
    selection: z
      .array(
        z.object({
          value: z.string().trim().min(1).max(500),
          structure: z.string().max(200),
          batch: z.string().max(200),
        }),
      )
      .max(25000),
    matchBy: z.enum(["filename", "fileId", "equipment", "folder"]),
    matchMode: z.enum(["exact", "stem", "contains"]),
    batchSize: z.number().int().min(1).max(5000),
  })
  .superRefine((v, ctx) => {
    if (v.kind === "copy" && !v.destination.trim())
      ctx.addIssue({
        code: "custom",
        message: "Choose a destination",
        path: ["destination"],
      });
    if (
      v.kind === "copy" &&
      ["structure", "batch"].includes(v.layout) &&
      (!v.selection.length || v.selection.some((r) => !r.structure.trim()))
    )
      ctx.addIssue({
        code: "custom",
        message:
          "Structure and batch layouts require a Structure ID for every selection row",
        path: ["selection"],
      });
  });
export function driveId(input: string) {
  const value = input.trim();
  if (/^[\w-]{10,}$/.test(value)) return value;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(
      "Enter a Google Drive link or file/folder ID, not a local path",
    );
  }
  if (!["drive.google.com", "docs.google.com"].includes(url.hostname))
    throw new Error("Only Google Drive links are supported");
  const id =
    url.pathname.match(/\/(?:folders|d)\/([\w-]+)/)?.[1] ??
    url.searchParams.get("id");
  if (!id || !/^[\w-]{10,}$/.test(id))
    throw new Error("Could not read the Drive ID from this link");
  return id;
}
export function extensions(value: string) {
  return [
    ...new Set(
      value
        .split(/[,;\s]+/)
        .map((s) =>
          s
            .trim()
            .toLowerCase()
            .replace(/^\*?\./, ""),
        )
        .filter(Boolean),
    ),
  ];
}
export function hasExtension(name: string, values: string[]) {
  return values.some((ext) =>
    name.toLowerCase().endsWith("." + ext.toLowerCase().replace(/^\*?\./, "")),
  );
}
export function included(name: string, config: JobConfig) {
  return (
    (!config.includeExtensions.length ||
      hasExtension(name, config.includeExtensions)) &&
    !hasExtension(name, config.excludeExtensions) &&
    (!config.nameIncludes ||
      name.toLowerCase().includes(config.nameIncludes.toLowerCase()))
  );
}
function basename(value: string) {
  return value.replace(/\\/g, "/").split("/").pop()!.trim().toLowerCase();
}
function stem(value: string) {
  return basename(value).replace(/\.[^.]+$/, "");
}
function escaped(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
export function matches(
  file: { id: string; name: string },
  row: Selection,
  config: JobConfig,
) {
  if (config.matchBy === "fileId") return file.id === row.value.trim();
  if (config.matchBy === "equipment")
    return new RegExp(
      `(^|[^a-z0-9])${escaped(row.value.toLowerCase())}([^a-z0-9]|$)`,
    ).test(stem(file.name));
  if (config.matchMode === "stem") return stem(file.name) === stem(row.value);
  if (config.matchMode === "contains")
    return basename(file.name).includes(basename(row.value));
  return basename(file.name) === basename(row.value);
}
export function safeSegment(value: string) {
  return (
    value
      .trim()
      .replace(/[\/\\\x00-\x1f]/g, "_")
      .replace(/^\.+$/, "_")
      .slice(0, 200) || "Unnamed"
  );
}
export function targetPath(
  config: JobConfig,
  relative: string,
  row?: Selection,
) {
  if (config.layout === "flat") return "";
  if (config.layout === "preserve") return relative;
  const structure = safeSegment(row!.structure);
  if (config.layout === "structure") return structure;
  const structures = [...new Set(config.selection.map((r) => r.structure))];
  const batch =
    row!.batch ||
    `Batch ${Math.floor(structures.indexOf(row!.structure) / config.batchSize) + 1}`;
  return `${safeSegment(batch)}/${structure}`;
}
export function renamed(name: string, sourceId: string) {
  const dot = name.lastIndexOf("."),
    suffix = `__${sourceId}`;
  return dot > 0
    ? name.slice(0, dot) + suffix + name.slice(dot)
    : name + suffix;
}
export function csvCell(value: unknown) {
  let text =
    value == null
      ? ""
      : typeof value === "object"
        ? JSON.stringify(value)
        : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = "'" + text;
  return '"' + text.replace(/"/g, '""') + '"';
}
