"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import {
  ArrowUpRight,
  ArrowRight,
  ArrowLeft,
  ArrowDownToLine,
  FolderInput,
  FolderOutput,
  FolderTree,
  Files,
  ScanLine,
  ListChecks,
  History,
  Plus,
  Play,
  Pause,
  RotateCcw,
  X,
  Check,
  ChevronRight,
  SlidersHorizontal,
  Cloud,
  ShieldCheck,
  LoaderCircle,
  Bookmark,
  Upload,
  Info,
  AlertCircle,
  LogOut,
  Search,
} from "lucide-react";
import Papa from "papaparse";
import { readSheet } from "read-excel-file/browser";
import { extensions, csvCell } from "@/lib/rules";
import type { JobConfig, Job, Selection } from "@/lib/types";
type Tab = "copy" | "metadata" | "inventory" | "jobs";
type User = { name: string; email: string };
type Detail = {
  job: Job;
  items: {
    id: string;
    name: string;
    target_path: string;
    relative_path: string;
    status: string;
    error: string | null;
    bytes: string;
  }[];
  scan: { folders: number; scanned: number };
  missing: number;
};
const base: JobConfig = {
  title: "",
  kind: "copy",
  sources: [],
  destination: "",
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
const presets = [
  { name: "All files", ext: [] },
  {
    name: "Images",
    ext: ["jpg", "jpeg", "png", "tif", "tiff", "webp", "heic", "bmp", "dng"],
  },
  { name: "JSON", ext: ["json", "jsonl", "ndjson"] },
  { name: "Archives", ext: ["zip", "7z", "rar", "tar", "gz"] },
  { name: "Documents", ext: ["pdf", "doc", "docx", "txt"] },
  { name: "Spreadsheets", ext: ["xlsx", "xls", "csv", "tsv"] },
];
async function api(path: string, options?: RequestInit) {
  const res = await fetch(path, { cache: "no-store", ...options });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error ?? "Request failed");
  return data;
}
const post = (data: unknown) => ({
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(data),
});
const size = (bytes: unknown) => {
  const n = Number(bytes);
  return !n
    ? "—"
    : n < 1024 * 1024
      ? `${(n / 1024).toFixed(1)} KB`
      : `${(n / 1024 / 1024).toFixed(1)} MB`;
};
const labels: Record<Tab, { title: string; sub: string }> = {
  copy: {
    title: "A better way to move your files.",
    sub: "Choose your folders. Set your rules. Let Relay take it from here.",
  },
  metadata: {
    title: "Get to know your images.",
    sub: "Extract available image metadata into a clean, downloadable CSV.",
  },
  inventory: {
    title: "See what’s in your folders.",
    sub: "Build a file inventory across your Drive, without moving a thing.",
  },
  jobs: {
    title: "Every job, in one place.",
    sub: "Review progress, pick up where you left off, and download reports.",
  },
};
export default function Workspace() {
  const [tab, setTab] = useState<Tab>("copy"),
    [config, setConfig] = useState<JobConfig>(base),
    [sources, setSources] = useState(""),
    [dest, setDest] = useState("");
  const [user, setUser] = useState<User | null>(null),
    [missing, setMissing] = useState<string[]>([]),
    [loading, setLoading] = useState(true),
    [busy, setBusy] = useState(false),
    [error, setError] = useState("");
  const [jobs, setJobs] = useState<Job[]>([]),
    [detail, setDetail] = useState<Detail | null>(null),
    [detailId, setDetailId] = useState(""),
    [advanced, setAdvanced] = useState(false);
  const [saved, setSaved] = useState<{ name: string; config: JobConfig }[]>([]),
    [selectedPreset, setSelectedPreset] = useState(""),
    [extensionsInput, setExtensionsInput] = useState(""),
    [excludeInput, setExcludeInput] = useState(""),
    [folderExclusions, setFolderExclusions] = useState("");
  const [sheet, setSheet] = useState<{
      headers: string[];
      rows: string[][];
      name: string;
    } | null>(null),
    [columns, setColumns] = useState({ value: "", structure: "", batch: "" }),
    [sheetName, setSheetName] = useState(""),
    [exporting, setExporting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const set = <K extends keyof JobConfig>(key: K, value: JobConfig[K]) =>
    setConfig((c) => ({ ...c, [key]: value }));
  const refresh = useCallback(async () => {
    const data = await api("/api/jobs");
    setJobs(data.jobs);
  }, []);
  const refreshDetail = useCallback(async (id: string) => {
    const data = await api(`/api/jobs/${id}`);
    setDetail(data);
  }, []);
  useEffect(() => {
    let valid = true;
    api("/api/me")
      .then(async (data) => {
        if (!valid) return;
        setUser(data.user);
        setMissing(data.missing);
        if (data.user) await refresh();
      })
      .catch((e) => {
        if (valid) setError(e.message);
      })
      .finally(() => {
        if (valid) setLoading(false);
      });
    try {
      setSaved(JSON.parse(localStorage.getItem("relay-presets") ?? "[]"));
    } catch {}
    const authError = new URLSearchParams(location.search).get("authError");
    if (authError) {
      const messages: Record<string, string> = {
        allowlist: "This Google email is not in ALLOWED_EMAILS.",
        scope: "Grant Google Drive access to use Relay.",
        offline:
          "Offline access was not granted. Reconnect your Google account.",
        state: "Sign-in expired. Please try again.",
        denied: "Google sign-in was cancelled.",
        setup: "Complete the deployment settings before connecting Google.",
      };
      setError(
        messages[authError] ??
          "Google connection failed. Check OAuth settings and database setup.",
      );
      history.replaceState({}, "", location.pathname);
    }
    return () => {
      valid = false;
    };
  }, [refresh]);
  useEffect(() => {
    if (!user) return;
    const timer = setInterval(() => {
      refresh().catch(() => {});
      if (detailId) refreshDetail(detailId).catch((e) => setError(e.message));
    }, 4000);
    return () => clearInterval(timer);
  }, [user, detailId, refresh, refreshDetail]);
  useEffect(() => {
    if (!detailId) {
      setDetail(null);
      return;
    }
    setDetail(null);
    refreshDetail(detailId).catch((e) => setError(e.message));
  }, [detailId, refreshDetail]);
  function navigate(next: Tab) {
    setTab(next);
    setDetailId("");
    setError("");
  }
  async function loadSheet(file: File) {
    setError("");
    if (file.size > 10 * 1024 * 1024) {
      setError("Choose a selection file smaller than 10 MB.");
      return;
    }
    try {
      let rows: string[][];
      if (file.name.toLowerCase().endsWith(".xlsx")) {
        const data = await readSheet(file, 1);
        rows = data.map((row) =>
          row.map((cell) => (cell == null ? "" : String(cell))),
        );
      } else if (/\.(csv|tsv)$/i.test(file.name)) {
        const data = Papa.parse<string[]>(await file.text(), {
          skipEmptyLines: "greedy",
        });
        if (data.errors.length)
          throw new Error(
            "Could not parse this CSV. Check delimiters and quoting.",
          );
        rows = data.data;
      } else
        throw new Error(
          "Use .xlsx, .csv or .tsv. Save older .xls files as .xlsx first.",
        );
      const headers = (rows.shift() ?? []).map(
        (v, i) => v.trim() || `Column ${i + 1}`,
      );
      if (!headers.length || !rows.length)
        throw new Error("This spreadsheet has no data rows.");
      if (new Set(headers).size !== headers.length)
        throw new Error("Column headers must be unique.");
      if (rows.length > 25000)
        throw new Error(
          "Maximum 25,000 selection rows per job. Split this list into smaller files.",
        );
      setSheet({ headers, rows, name: file.name });
      setSheetName(file.name);
      setColumns({
        value:
          headers.find((h) =>
            /filename|file_location|equipment|^id$|file_id/i.test(h),
          ) ?? headers[0],
        structure: headers.find((h) => /structure/i.test(h)) ?? "",
        batch: headers.find((h) => /^batch/i.test(h)) ?? "",
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      if (fileInput.current) fileInput.current.value = "";
    }
  }
  function mappedSelection(): Selection[] {
    if (!sheet) return config.selection;
    const v = sheet.headers.indexOf(columns.value),
      s = sheet.headers.indexOf(columns.structure),
      b = sheet.headers.indexOf(columns.batch);
    return sheet.rows
      .filter((r) => r[v]?.trim())
      .map((r) => ({
        value: r[v].trim(),
        structure: s < 0 ? "" : (r[s]?.trim() ?? ""),
        batch: b < 0 ? "" : (r[b]?.trim() ?? ""),
      }));
  }
  async function scan() {
    setError("");
    setBusy(true);
    try {
      const selection = mappedSelection();
      const payload = {
        ...config,
        kind: tab === "jobs" ? "copy" : tab,
        title:
          config.title.trim() ||
          `${tab === "copy" ? "Copy" : tab === "metadata" ? "Metadata" : "Inventory"} · ${new Date().toLocaleDateString("en-GB")}`,
        sources: sources
          .split("\n")
          .map((s) => s.trim())
          .filter(Boolean),
        destination: dest.trim(),
        includeExtensions: extensions(extensionsInput),
        excludeExtensions: extensions(excludeInput),
        excludedFolders: folderExclusions
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
        selection,
      };
      if (!payload.sources.length)
        throw new Error("Enter at least one source.");
      if (
        payload.kind === "copy" &&
        ["structure", "batch"].includes(payload.layout) &&
        (!selection.length || selection.some((r) => !r.structure))
      )
        throw new Error(
          "Upload a selection list and map a Structure ID column for this layout.",
        );
      const data = await api("/api/jobs", post(payload));
      await refresh();
      setDetailId(data.job.id);
      if (data.dispatchError)
        setError(
          "Job saved, but queuing failed. Check Inngest settings and use Resume.",
        );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function action(name: string) {
    if (!detail) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/jobs/${detail.job.id}`, post({ action: name }));
      await Promise.all([refreshDetail(detail.job.id), refresh()]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function download(type = "items") {
    if (!detail) return;
    setExporting(true);
    setError("");
    try {
      const rows: Record<string, unknown>[] = [];
      let offset: number | null = 0;
      do {
        const page = await api(
          `/api/jobs/${detail.job.id}/report?type=${type}&offset=${offset}`,
        );
        rows.push(...page.rows);
        offset = page.next;
      } while (offset !== null);
      if (!rows.length) throw new Error("No report rows are available yet.");
      const headers = Object.keys(rows[0]),
        csv =
          "\uFEFF" +
          [
            headers.map(csvCell).join(","),
            ...rows.map((r) => headers.map((h) => csvCell(r[h])).join(",")),
          ].join("\r\n");
      const url = URL.createObjectURL(
        new Blob([csv], { type: "text/csv;charset=utf-8;" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = `relay-${detail.job.id.slice(0, 8)}-${type}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setExporting(false);
    }
  }
  function savePreset() {
    const name = config.title.trim();
    if (!name) {
      setError("Give this job a name before saving a preset.");
      return;
    }
    const next = [
      ...saved.filter((p) => p.name !== name),
      {
        name,
        config: {
          ...config,
          sources: sources.split("\n").filter(Boolean),
          destination: dest,
          includeExtensions: extensions(extensionsInput),
          excludeExtensions: extensions(excludeInput),
          excludedFolders: folderExclusions
            .split(",")
            .map((v) => v.trim())
            .filter(Boolean),
          selection: [],
        },
      },
    ];
    setSaved(next);
    localStorage.setItem("relay-presets", JSON.stringify(next));
    setSelectedPreset(name);
  }
  function applyPreset(name: string) {
    setSelectedPreset(name);
    const item = saved.find((p) => p.name === name);
    if (!item) return;
    setConfig({ ...base, ...item.config });
    setSources(item.config.sources.join("\n"));
    setDest(item.config.destination);
    setExtensionsInput(item.config.includeExtensions.join(", "));
    setExcludeInput(item.config.excludeExtensions.join(", "));
    setFolderExclusions(item.config.excludedFolders.join(", "));
    setSheet(null);
    setSheetName("");
  }
  const running = jobs.filter((j) =>
    ["scanning", "copying"].includes(j.status),
  ).length;
  const selectionCount = sheet
    ? sheet.rows.filter((r) => r[sheet.headers.indexOf(columns.value)]?.trim())
        .length
    : config.selection.length;
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <a className="brand" href="/">
          <span className="brand-mark">
            <ArrowUpRight size={23} />
          </span>
          relay<span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">YOUR WORKSPACE</div>
        <nav>
          {(
            [
              { id: "copy", icon: Files, label: "Copy files" },
              { id: "metadata", icon: ScanLine, label: "Image metadata" },
              { id: "inventory", icon: ListChecks, label: "Folder inventory" },
              { id: "jobs", icon: History, label: "Job history" },
            ] as const
          ).map((n) => (
            <button
              key={n.id}
              className={tab === n.id ? "nav-item active" : "nav-item"}
              onClick={() => navigate(n.id)}
            >
              <n.icon size={18} />
              {n.label}
              {n.id === "jobs" && running > 0 && (
                <span className="nav-count">{running}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-tip">
          <Cloud size={23} />
          <strong>Set it. Then get on with it.</strong>
          <p>
            Jobs keep running in the background, even when this tab is closed.
          </p>
          <span>
            Powered by Google Drive <ArrowUpRight size={12} />
          </span>
        </div>
        <div className="account">
          <div className="avatar">
            {user ? user.name.charAt(0).toUpperCase() : "R"}
          </div>
          <div>
            <strong>{user ? user.name.split(" ")[0] : "Your workspace"}</strong>
            <span>{user ? "Google connected" : "Connect to get started"}</span>
          </div>
          {user && (
            <button
              className="icon-btn"
              title="Sign out"
              onClick={async () => {
                try {
                  await api("/api/auth/logout", post({}));
                  location.reload();
                } catch (e) {
                  setError((e as Error).message);
                }
              }}
            >
              <LogOut size={16} />
            </button>
          )}
        </div>
      </aside>
      <main>
        <header className="topbar">
          <span>
            Workspace <ChevronRight size={14} />{" "}
            {tab === "copy"
              ? "Copy files"
              : tab === "metadata"
                ? "Image metadata"
                : tab === "inventory"
                  ? "Folder inventory"
                  : "Job history"}
          </span>
          <div className="connection">
            <i className={user ? "online" : ""} />
            {loading
              ? "Checking connection"
              : user
                ? "Google Drive connected"
                : "Google Drive not connected"}
          </div>
        </header>
        <div className="main-content">
          <div className="eyebrow">LESS BUSYWORK. MORE PROGRESS.</div>
          <div className="page-heading">
            <div>
              <h1>{detailId ? "Your job, at a glance." : labels[tab].title}</h1>
              <p>
                {detailId
                  ? "A saved preview, clear progress, and control over every step."
                  : labels[tab].sub}
              </p>
            </div>
            <span className="workspace-badge">
              <ShieldCheck size={15} /> Private workspace
            </span>
          </div>
          {error && (
            <div role="alert" className="banner error">
              <AlertCircle size={18} />
              <span>{error}</span>
              <button
                aria-label="Dismiss error"
                className="icon-btn"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {missing.length > 0 && (
            <div className="banner setup">
              <SlidersHorizontal size={19} />
              <div>
                <strong>One-time setup needed</strong>
                <p>
                  Configure {missing.join(", ")} and run the database migration.
                  Follow README.md in your repository.
                </p>
              </div>
            </div>
          )}
          {!loading && !user && !missing.length && (
            <div className="banner connect">
              <Cloud size={22} />
              <div>
                <strong>Connect your Google Drive</strong>
                <p>
                  Use an allowed Google account to access My Drive and Shared
                  Drives.
                </p>
              </div>
              <a className="btn primary" href="/api/auth/login">
                Connect Google <ArrowUpRight size={16} />
              </a>
            </div>
          )}
          {detailId ? (
            !detail ? (
              <div className="empty">
                <LoaderCircle className="spin" />
                Loading job…
              </div>
            ) : (
              <>
                <button className="back-btn" onClick={() => setDetailId("")}>
                  <ArrowLeft size={15} /> Back to{" "}
                  {tab === "jobs" ? "job history" : "workspace"}
                </button>
                <section className="card job-detail">
                  <div className="card-top">
                    <div>
                      <div className="eyebrow">
                        {detail.job.kind.toUpperCase()} JOB ·{" "}
                        {detail.job.id.slice(0, 8)}
                      </div>
                      <h2>{detail.job.title}</h2>
                    </div>
                    <Status value={detail.job.status} />
                  </div>
                  <div className="metric-grid">
                    {[
                      ["Discovered", detail.job.total],
                      ["Copied", detail.job.copied],
                      ["Skipped", detail.job.skipped],
                      ["Errors", detail.job.errors],
                      ["Ambiguous", detail.job.ambiguous],
                    ].map(([label, value]) => (
                      <div key={label}>
                        <span>{label}</span>
                        <strong>{Number(value ?? 0).toLocaleString()}</strong>
                      </div>
                    ))}
                  </div>
                  <div className="progress-track">
                    <div
                      style={{
                        width: `${detail.job.status === "completed" ? 100 : detail.job.status === "scanning" ? Math.min(95, (detail.scan.scanned / Math.max(1, detail.scan.folders)) * 100) : (((detail.job.copied ?? 0) + (detail.job.skipped ?? 0) + (detail.job.errors ?? 0) + (detail.job.ambiguous ?? 0)) / Math.max(1, detail.job.total ?? 0)) * 100}%`,
                      }}
                    />
                  </div>
                  <p className="helper">
                    {detail.job.status === "scanning"
                      ? `${detail.scan.scanned} of ${detail.scan.folders} discovered folders scanned. The total can grow as subfolders are found.`
                      : detail.job.status === "ready"
                        ? `${detail.job.pending ?? 0} files are ready to copy. Review the preview before starting.`
                        : detail.job.status === "completed"
                          ? detail.job.kind === "copy"
                            ? "Job finished. Review skipped files, errors and ambiguous matches in the report."
                            : "Scan complete. Download the CSV to inspect your results."
                          : detail.job.status === "paused"
                            ? "Progress saved. Resume when you’re ready."
                            : "Progress updates every few seconds."}
                  </p>
                  {detail.job.error && (
                    <div className="banner error">{detail.job.error}</div>
                  )}
                  {detail.missing > 0 && (
                    <div className="banner setup">
                      <Info size={18} />
                      {detail.missing} spreadsheet rows have no matching file in
                      the current scan. Download the selection report for
                      details.
                    </div>
                  )}
                  {!!detail.job.ambiguous && (
                    <div className="banner setup">
                      <Info size={18} />
                      Ambiguous matches will not be copied. Correct your
                      selection and create a new preview for those files.
                    </div>
                  )}
                  <div className="job-actions">
                    {detail.job.status === "ready" && (
                      <button
                        disabled={busy}
                        className="btn primary"
                        onClick={() => action("start")}
                      >
                        <Play size={16} />
                        Start copy job · {detail.job.pending ?? 0} files
                      </button>
                    )}
                    {["scanning", "copying"].includes(detail.job.status) && (
                      <button
                        disabled={busy}
                        className="btn secondary"
                        onClick={() => action("pause")}
                      >
                        <Pause size={16} />
                        Pause
                      </button>
                    )}
                    {["paused", "failed"].includes(detail.job.status) && (
                      <button
                        disabled={busy}
                        className="btn primary"
                        onClick={() => action("resume")}
                      >
                        <Play size={16} />
                        Resume job
                      </button>
                    )}
                    {detail.job.status === "completed" &&
                      !!detail.job.errors &&
                      detail.job.kind === "copy" && (
                        <button
                          disabled={busy}
                          className="btn secondary"
                          onClick={() => action("retry")}
                        >
                          <RotateCcw size={16} />
                          Retry errors
                        </button>
                      )}
                    {!["scanning", "copying"].includes(detail.job.status) && (
                      <button
                        disabled={exporting}
                        className="btn secondary"
                        onClick={() => download()}
                      >
                        <ArrowDownToLine size={16} />
                        {exporting
                          ? "Preparing…"
                          : detail.job.kind === "metadata"
                            ? "Download metadata CSV"
                            : "Download file report"}
                      </button>
                    )}
                    {detail.job.config.selection.length > 0 &&
                      !["scanning", "copying"].includes(detail.job.status) && (
                        <button
                          disabled={exporting}
                          className="btn secondary"
                          onClick={() => download("selection")}
                        >
                          Selection report
                        </button>
                      )}
                    {!["completed", "cancelled"].includes(
                      detail.job.status,
                    ) && (
                      <button
                        disabled={busy}
                        className="btn subtle"
                        onClick={() => action("cancel")}
                      >
                        <X size={16} />
                        Cancel job
                      </button>
                    )}
                    {["scanning", "copying"].includes(detail.job.status) &&
                      Date.now() - new Date(detail.job.updated_at).getTime() >
                        120000 && (
                        <button
                          disabled={busy}
                          className="btn subtle"
                          onClick={() => action("resume")}
                        >
                          <RotateCcw size={16} />
                          Requeue stalled job
                        </button>
                      )}
                  </div>
                  <details className="job-settings">
                    <summary>Sources, destination and filters</summary>
                    <p>Sources: {detail.job.config.sources.join(", ")}</p>
                    {detail.job.kind === "copy" && (
                      <p>Destination: {detail.job.config.destination}</p>
                    )}
                    <p>
                      Extensions:{" "}
                      {detail.job.config.includeExtensions.join(", ") ||
                        "All files"}{" "}
                      ·{" "}
                      {detail.job.config.recursive
                        ? "Recursive"
                        : "Current folder only"}{" "}
                      · Layout: {detail.job.config.layout} · Collision policy:{" "}
                      {detail.job.config.conflicts}
                    </p>
                  </details>
                </section>
                <section className="card table-card">
                  <div className="card-top">
                    <h3>File preview</h3>
                    <span className="helper">
                      First 100 files · full details in CSV
                    </span>
                  </div>
                  <div className="table-scroll">
                    <table>
                      <thead>
                        <tr>
                          <th>Filename</th>
                          <th>Destination folder</th>
                          <th>Size</th>
                          <th>Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.items.map((item) => (
                          <tr key={item.id}>
                            <td>
                              <div className="filename">
                                <Files size={15} />
                                <div>
                                  {item.name}
                                  {item.error && <small>{item.error}</small>}
                                </div>
                              </div>
                            </td>
                            <td>
                              {detail.job.kind === "copy"
                                ? item.target_path || "Destination root"
                                : item.relative_path || "Source root"}
                            </td>
                            <td>{size(item.bytes)}</td>
                            <td>
                              <Status value={item.status} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {!detail.items.length && (
                      <div className="empty">
                        {detail.job.status === "scanning"
                          ? "Looking for matching files…"
                          : "No files matched these rules."}
                      </div>
                    )}
                  </div>
                </section>
              </>
            )
          ) : tab === "jobs" ? (
            <section className="card table-card">
              <div className="card-top">
                <h3>
                  Recent jobs <span className="count">{jobs.length}</span>
                </h3>
                <button
                  className="btn secondary small"
                  onClick={() => navigate("copy")}
                >
                  <Plus size={15} />
                  New copy job
                </button>
              </div>
              <JobList jobs={jobs} onSelect={setDetailId} />
            </section>
          ) : (
            <div className="workspace-grid">
              <div className="form-column">
                <section className="card">
                  <div className="card-top">
                    <h3>
                      <span className="step">1</span>
                      {tab === "copy"
                        ? "Choose your locations"
                        : "Choose your source folders"}
                    </h3>
                    <span className="helper">Google Drive</span>
                  </div>
                  {saved.length > 0 && (
                    <div className="preset-row">
                      <Bookmark size={15} />
                      <select
                        aria-label="Load saved preset"
                        value={selectedPreset}
                        onChange={(e) => applyPreset(e.target.value)}
                      >
                        <option value="">Load a saved preset</option>
                        {saved.map((p) => (
                          <option key={p.name}>{p.name}</option>
                        ))}
                      </select>
                      <button
                        aria-label="Delete selected preset"
                        disabled={!selectedPreset}
                        className="icon-btn"
                        onClick={() => {
                          const next = saved.filter(
                            (p) => p.name !== selectedPreset,
                          );
                          setSaved(next);
                          localStorage.setItem(
                            "relay-presets",
                            JSON.stringify(next),
                          );
                          setSelectedPreset("");
                        }}
                      >
                        <X size={14} />
                      </button>
                    </div>
                  )}
                  <Field label="Job name" optional>
                    <input
                      value={config.title}
                      onChange={(e) => set("title", e.target.value)}
                      placeholder={
                        tab === "copy"
                          ? "e.g. PG&E · Batch 3 images and annotations"
                          : "e.g. Batch 3 · folder audit"
                      }
                    />
                  </Field>
                  <Field
                    label="Source folders or files"
                    hint="One Drive link or ID per line. My Drive, Shared Drives and shared folders are supported."
                  >
                    <div className="input-with-icon textarea">
                      <FolderInput size={18} />
                      <textarea
                        rows={3}
                        value={sources}
                        onChange={(e) => setSources(e.target.value)}
                        placeholder={
                          "Paste Google Drive folder links or IDs\nAdd another source on a new line"
                        }
                      />
                    </div>
                  </Field>
                  {tab === "copy" && (
                    <Field
                      label="Destination folder"
                      hint="Copies go here. Your source files stay where they are."
                    >
                      <div className="input-with-icon">
                        <FolderOutput size={18} />
                        <input
                          value={dest}
                          onChange={(e) => setDest(e.target.value)}
                          placeholder="Paste destination folder link or ID"
                        />
                      </div>
                    </Field>
                  )}
                  <div className="depth-options">
                    <button
                      className={
                        config.recursive ? "choice selected" : "choice"
                      }
                      onClick={() => set("recursive", true)}
                    >
                      <FolderTree size={18} />
                      <div>
                        <strong>Include subfolders</strong>
                        <span>Search the full folder tree</span>
                      </div>
                      <span className="radio" />
                    </button>
                    <button
                      className={
                        !config.recursive ? "choice selected" : "choice"
                      }
                      onClick={() => set("recursive", false)}
                    >
                      <Files size={18} />
                      <div>
                        <strong>Current folder only</strong>
                        <span>Files directly in each source</span>
                      </div>
                      <span className="radio" />
                    </button>
                  </div>
                </section>
                <section className="card">
                  <div className="card-top">
                    <h3>
                      <span className="step">2</span>Choose what to{" "}
                      {tab === "copy" ? "copy" : "inspect"}
                    </h3>
                    <span className="pill neutral">Any file type</span>
                  </div>
                  <label className="field-label">File types</label>
                  <div className="file-presets">
                    {presets.map((p) => {
                      const active =
                        p.ext.join(",") ===
                        extensions(extensionsInput).join(",");
                      return (
                        <button
                          key={p.name}
                          className={active ? "chip selected" : "chip"}
                          onClick={() => setExtensionsInput(p.ext.join(", "))}
                        >
                          {active && <Check size={13} />} {p.name}
                        </button>
                      );
                    })}
                  </div>
                  <Field
                    label="Include extensions"
                    hint="Leave blank for all files. Combine any formats, including compound extensions like tar.gz."
                  >
                    <input
                      value={extensionsInput}
                      onChange={(e) => setExtensionsInput(e.target.value)}
                      placeholder="e.g. jpg, json, zip, csv, pdf"
                    />
                  </Field>
                  <div className="selection-panel">
                    <div>
                      <ListChecks size={18} />
                      <div>
                        <strong>Copy from a list</strong>
                        <p>
                          Select filenames, file IDs, equipment IDs or folder
                          names using Excel or CSV.
                        </p>
                      </div>
                    </div>
                    <button
                      className="btn secondary small"
                      onClick={() => fileInput.current?.click()}
                    >
                      <Upload size={14} />
                      {sheet || config.selection.length
                        ? "Replace list"
                        : "Upload list"}
                    </button>
                    <input
                      ref={fileInput}
                      type="file"
                      accept=".xlsx,.csv,.tsv"
                      hidden
                      onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) loadSheet(f);
                      }}
                    />
                  </div>
                  {(sheet || config.selection.length > 0) && (
                    <div className="mapping">
                      <div className="mapping-title">
                        <strong>
                          {sheetName || "Saved selection"}{" "}
                          <span className="pill neutral">
                            {selectionCount.toLocaleString()} rows
                          </span>
                        </strong>
                        <button
                          aria-label="Remove selection list"
                          className="icon-btn"
                          onClick={() => {
                            setSheet(null);
                            setSheetName("");
                            set("selection", []);
                          }}
                        >
                          <X size={16} />
                        </button>
                      </div>
                      {sheet && (
                        <div className="three-fields">
                          <Field label="Match values">
                            <select
                              value={columns.value}
                              onChange={(e) =>
                                setColumns((c) => ({
                                  ...c,
                                  value: e.target.value,
                                }))
                              }
                            >
                              {sheet.headers.map((h) => (
                                <option key={h}>{h}</option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Structure ID">
                            <select
                              value={columns.structure}
                              onChange={(e) =>
                                setColumns((c) => ({
                                  ...c,
                                  structure: e.target.value,
                                }))
                              }
                            >
                              <option value="">Not used</option>
                              {sheet.headers.map((h) => (
                                <option key={h}>{h}</option>
                              ))}
                            </select>
                          </Field>
                          <Field label="Batch">
                            <select
                              value={columns.batch}
                              onChange={(e) =>
                                setColumns((c) => ({
                                  ...c,
                                  batch: e.target.value,
                                }))
                              }
                            >
                              <option value="">Auto assign</option>
                              {sheet.headers.map((h) => (
                                <option key={h}>{h}</option>
                              ))}
                            </select>
                          </Field>
                        </div>
                      )}
                      <div className="two-fields">
                        <Field label="Values represent">
                          <select
                            value={config.matchBy}
                            onChange={(e) =>
                              set(
                                "matchBy",
                                e.target.value as JobConfig["matchBy"],
                              )
                            }
                          >
                            <option value="filename">Filenames</option>
                            <option value="fileId">Drive file IDs</option>
                            <option value="equipment">
                              Equipment IDs in filenames
                            </option>
                            <option value="folder">
                              Folder names or IDs (all contents)
                            </option>
                          </select>
                        </Field>
                        <Field label="Filename matching">
                          <select
                            disabled={config.matchBy !== "filename"}
                            value={config.matchMode}
                            onChange={(e) =>
                              set(
                                "matchMode",
                                e.target.value as JobConfig["matchMode"],
                              )
                            }
                          >
                            <option value="exact">
                              Exact · case insensitive
                            </option>
                            <option value="stem">
                              Ignore extension · JPG/JPEG etc.
                            </option>
                            <option value="contains">
                              Filename contains value
                            </option>
                          </select>
                        </Field>
                      </div>
                      <p className="helper">
                        Equipment and folder IDs may select multiple files.
                        Ambiguous filename matches are excluded from copying.
                        XLSX uses the first worksheet.
                      </p>
                    </div>
                  )}
                  <button
                    className="advanced-toggle"
                    onClick={() => setAdvanced(!advanced)}
                  >
                    <SlidersHorizontal size={16} />
                    More filters{" "}
                    <ChevronRight
                      size={15}
                      className={advanced ? "turned" : ""}
                    />
                  </button>
                  {advanced && (
                    <div className="advanced-fields">
                      <div className="two-fields">
                        <Field label="Exclude extensions">
                          <input
                            value={excludeInput}
                            onChange={(e) => setExcludeInput(e.target.value)}
                            placeholder="e.g. txt, xml"
                          />
                        </Field>
                        <Field label="Filename contains">
                          <input
                            value={config.nameIncludes}
                            onChange={(e) =>
                              set("nameIncludes", e.target.value)
                            }
                            placeholder="Optional text filter"
                          />
                        </Field>
                      </div>
                      <Field
                        label="Exclude folder names"
                        hint="Exact folder names, separated by commas. Applies to subfolders."
                      >
                        <input
                          value={folderExclusions}
                          onChange={(e) => setFolderExclusions(e.target.value)}
                          placeholder="e.g. annotations, thumbnails"
                        />
                      </Field>
                    </div>
                  )}
                </section>
                {tab === "copy" && (
                  <section className="card">
                    <div className="card-top">
                      <h3>
                        <span className="step">3</span>Set up your destination
                      </h3>
                    </div>
                    <div className="two-fields">
                      <Field label="Folder layout">
                        <select
                          value={config.layout}
                          onChange={(e) =>
                            set("layout", e.target.value as JobConfig["layout"])
                          }
                        >
                          <option value="preserve">
                            Preserve folder structure
                          </option>
                          <option value="flat">All files in one folder</option>
                          <option value="structure">
                            One folder per Structure ID
                          </option>
                          <option value="batch">
                            Batch → Structure ID folders
                          </option>
                        </select>
                      </Field>
                      <Field label="When a filename already exists">
                        <select
                          value={config.conflicts}
                          onChange={(e) =>
                            set(
                              "conflicts",
                              e.target.value as JobConfig["conflicts"],
                            )
                          }
                        >
                          <option value="skip">Skip existing</option>
                          <option value="rename">Rename the new copy</option>
                          <option value="error">Report an error</option>
                        </select>
                      </Field>
                    </div>
                    {config.layout === "batch" && (
                      <Field
                        label="Structures per batch"
                        hint="Used when your spreadsheet has no batch value. Order follows the selection list."
                      >
                        <input
                          type="number"
                          min={1}
                          max={5000}
                          value={config.batchSize}
                          onChange={(e) =>
                            set("batchSize", Number(e.target.value))
                          }
                        />
                      </Field>
                    )}
                    <div className="inline-note">
                      <ShieldCheck size={16} />
                      {config.conflicts === "skip"
                        ? "Skip compares filenames, not file contents. No existing files are replaced."
                        : "Originals and existing destination files are never overwritten."}
                    </div>
                  </section>
                )}
                <div className="form-footer">
                  <button className="btn secondary" onClick={savePreset}>
                    <Bookmark size={16} />
                    Save preset
                  </button>
                  <button
                    className="btn primary"
                    disabled={
                      !user ||
                      busy ||
                      !sources.trim() ||
                      (tab === "copy" && !dest.trim())
                    }
                    onClick={scan}
                  >
                    {busy ? (
                      <LoaderCircle size={16} className="spin" />
                    ) : (
                      <Search size={16} />
                    )}{" "}
                    {tab === "copy" ? "Scan & preview" : "Scan & create report"}
                    <ArrowRight size={16} />
                  </button>
                </div>
                <p className="footer-note">
                  {tab === "copy"
                    ? "Nothing is copied until you review the preview and start the job."
                    : "This scan reads Drive metadata and makes no changes to your files."}
                </p>
              </div>
              <aside className="right-column">
                <div className="how-card">
                  <div className="how-icon">
                    <ArrowUpRight size={26} />
                  </div>
                  <h2>
                    Your files.
                    <br />
                    Your rules.
                  </h2>
                  <p>
                    A little setup now.
                    <br />A lot less manual work later.
                  </p>
                  <div className="how-steps">
                    <div>
                      <span>01</span>
                      <div>
                        <strong>Choose & filter</strong>
                        <p>One folder or a whole dataset.</p>
                      </div>
                    </div>
                    <div>
                      <span>02</span>
                      <div>
                        <strong>Review the plan</strong>
                        <p>Catch missing or ambiguous files.</p>
                      </div>
                    </div>
                    <div>
                      <span>03</span>
                      <div>
                        <strong>Run & carry on</strong>
                        <p>Saved progress. Easy resumes.</p>
                      </div>
                    </div>
                  </div>
                </div>
                {tab === "metadata" && (
                  <div className="tip-card">
                    <ScanLine size={19} />
                    <h4>Available image metadata</h4>
                    <p>
                      Dimensions, capture date, camera, GPS and more, where
                      Google Drive exposes them. Missing values stay blank; this
                      is not a full binary EXIF extraction.
                    </p>
                  </div>
                )}
                <div className="recent-card">
                  <div>
                    <h4>Recent activity</h4>
                    <button onClick={() => navigate("jobs")}>
                      View all <ArrowRight size={13} />
                    </button>
                  </div>
                  {jobs.length ? (
                    jobs.slice(0, 3).map((j) => (
                      <button
                        className="recent-job"
                        key={j.id}
                        onClick={() => setDetailId(j.id)}
                      >
                        <span className="mini-file">
                          <Files size={15} />
                        </span>
                        <span>
                          <strong>{j.title}</strong>
                          <small>
                            {new Date(j.created_at).toLocaleDateString("en-GB")}{" "}
                            · {j.total ?? 0} files
                          </small>
                        </span>
                        <Status value={j.status} />
                      </button>
                    ))
                  ) : (
                    <p className="helper">
                      Your jobs will appear here after your first scan.
                    </p>
                  )}
                </div>
                <div className="tip-card">
                  <Info size={18} />
                  <h4>Built for Drive datasets</h4>
                  <p>
                    JSON, ZIP, images, documents and custom formats. Copies stay
                    within Google Drive, without downloading through your
                    browser.
                  </p>
                </div>
              </aside>
            </div>
          )}
          <footer className="page-footer">
            <span>RELAY / FILE & IMAGE TOOLKIT</span>
            <span>Less repetition. More momentum.</span>
          </footer>
        </div>
      </main>
    </div>
  );
}
function Field({
  label,
  hint,
  optional,
  children,
}: {
  label: string;
  hint?: string;
  optional?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className="field">
      <span className="field-label">
        {label}
        {optional && <span className="optional">Optional</span>}
      </span>
      {children}
      {hint && <span className="helper">{hint}</span>}
    </label>
  );
}
function Status({ value }: { value: string }) {
  return (
    <span className={`status status-${value}`}>
      <i />
      {value === "ready"
        ? "Preview ready"
        : value.charAt(0).toUpperCase() + value.slice(1)}
    </span>
  );
}
function JobList({
  jobs,
  onSelect,
}: {
  jobs: Job[];
  onSelect: (id: string) => void;
}) {
  return jobs.length ? (
    <div className="table-scroll">
      <table>
        <thead>
          <tr>
            <th>Job</th>
            <th>Files</th>
            <th>Created</th>
            <th>Status</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {jobs.map((j) => (
            <tr key={j.id}>
              <td>
                <button className="job-link" onClick={() => onSelect(j.id)}>
                  {j.title}
                  <small>
                    {j.kind === "copy"
                      ? "Copy files"
                      : j.kind === "metadata"
                        ? "Image metadata"
                        : "Folder inventory"}
                  </small>
                </button>
              </td>
              <td>{(j.total ?? 0).toLocaleString()}</td>
              <td>{new Date(j.created_at).toLocaleString("en-GB")}</td>
              <td>
                <Status value={j.status} />
              </td>
              <td>
                <button
                  aria-label={`Open ${j.title}`}
                  className="icon-btn"
                  onClick={() => onSelect(j.id)}
                >
                  <ArrowUpRight size={17} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  ) : (
    <div className="empty">
      <History size={28} />
      <h3>A fresh start.</h3>
      <p>Create your first job to see progress and reports here.</p>
    </div>
  );
}
