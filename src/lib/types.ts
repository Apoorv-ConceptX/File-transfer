export type Selection = { value: string; structure: string; batch: string };
export type JobConfig = {
  title: string;
  kind: "copy" | "metadata" | "inventory";
  sources: string[];
  destination: string;
  recursive: boolean;
  includeExtensions: string[];
  excludeExtensions: string[];
  nameIncludes: string;
  excludedFolders: string[];
  layout: "preserve" | "flat" | "structure" | "batch";
  conflicts: "skip" | "rename" | "error";
  selection: Selection[];
  matchBy: "filename" | "fileId" | "equipment" | "folder";
  matchMode: "exact" | "stem" | "contains";
  batchSize: number;
};
export type Job = {
  id: string;
  user_id: string;
  title: string;
  kind: JobConfig["kind"];
  config: JobConfig;
  status:
    | "scanning"
    | "ready"
    | "copying"
    | "paused"
    | "completed"
    | "failed"
    | "cancelled";
  phase: "scan" | "copy";
  generation: number;
  sequence: number;
  error: string | null;
  created_at: string;
  updated_at: string;
  total?: number;
  copied?: number;
  skipped?: number;
  errors?: number;
  ambiguous?: number;
  pending?: number;
};
export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  parents?: string[];
  size?: string;
  md5Checksum?: string;
  modifiedTime?: string;
  webViewLink?: string;
  appProperties?: Record<string, string>;
  trashed?: boolean;
  capabilities?: { canAddChildren?: boolean; canCopy?: boolean };
  shortcutDetails?: { targetId: string; targetMimeType: string };
  imageMediaMetadata?: Record<string, unknown>;
};
export type Item = {
  id: string;
  job_id: string;
  source_id: string;
  name: string;
  relative_path: string;
  target_path: string;
  mime_type: string;
  bytes: string | null;
  checksum: string | null;
  metadata: DriveFile;
  status: string;
  error: string | null;
  destination_id: string | null;
};
export const FOLDER = "application/vnd.google-apps.folder";
export const SHORTCUT = "application/vnd.google-apps.shortcut";
