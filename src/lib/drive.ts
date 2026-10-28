import { query } from "./db";
import { decrypt } from "./crypto";
import { env, allowedEmail } from "./config";
import { FOLDER, SHORTCUT, type DriveFile } from "./types";
export class DriveError extends Error {
  constructor(
    public status: number,
    public transient: boolean,
    message: string,
  ) {
    super(message);
  }
}
const fields =
  "id,name,mimeType,parents,size,md5Checksum,modifiedTime,webViewLink,appProperties,trashed,capabilities,shortcutDetails,imageMediaMetadata";
export const escapeQuery = (value: string) =>
  value.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
export class Drive {
  constructor(private token: string) {}
  static async forUser(userId: string) {
    const [user] = await query(
      "SELECT refresh_token,email FROM users WHERE id=$1",
      [userId],
    );
    if (!user || !allowedEmail(user.email))
      throw new Error("Google account is unavailable. Sign in again.");
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: decrypt(user.refresh_token),
        client_id: env("GOOGLE_CLIENT_ID"),
        client_secret: env("GOOGLE_CLIENT_SECRET"),
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok)
      throw new DriveError(
        response.status,
        response.status >= 500 || response.status === 429,
        "Google sign-in expired or unavailable. Reconnect Google and resume the job.",
      );
    return new Drive((await response.json()).access_token);
  }
  async request<T>(
    path: string,
    params: Record<string, string> = {},
    body?: unknown,
  ): Promise<T> {
    const url = new URL(`https://www.googleapis.com/drive/v3/${path}`);
    url.search = new URLSearchParams({
      supportsAllDrives: "true",
      ...params,
    }).toString();
    const response = await fetch(url, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(12000),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      const reason = error.error?.errors?.[0]?.reason;
      const transient =
        response.status === 429 ||
        response.status >= 500 ||
        ["rateLimitExceeded", "userRateLimitExceeded"].includes(reason);
      const messages: Record<number, string> = {
        401: "Google access expired. Reconnect and resume.",
        403: "Google denied access, copying, or quota. Check folder permissions and Drive limits.",
        404: "Drive file/folder no longer exists or you do not have access.",
      };
      throw new DriveError(
        response.status,
        transient,
        transient
          ? "Google is rate limiting or temporarily unavailable."
          : (messages[response.status] ??
              `Drive request failed (${response.status}).`),
      );
    }
    return response.json();
  }
  get(id: string) {
    return this.request<DriveFile>(`files/${encodeURIComponent(id)}`, {
      fields,
    });
  }
  list(parent: string, pageToken?: string, extra = "") {
    return this.request<{
      files: DriveFile[];
      nextPageToken?: string;
      incompleteSearch?: boolean;
    }>("files", {
      q: `'${escapeQuery(parent)}' in parents and trashed=false${extra ? " and " + extra : ""}`,
      fields: `nextPageToken,incompleteSearch,files(${fields})`,
      pageSize: "100",
      includeItemsFromAllDrives: "true",
      ...(pageToken ? { pageToken } : {}),
      orderBy: "name",
    });
  }
  async allMatching(parent: string, extra: string) {
    let token: string | undefined;
    const files: DriveFile[] = [];
    do {
      const page = await this.list(parent, token, extra);
      if (page.incompleteSearch)
        throw new Error("Drive returned an incomplete search. Retry this job.");
      files.push(...page.files);
      token = page.nextPageToken;
    } while (token);
    return files;
  }
  async resolve(id: string) {
    let file = await this.get(id);
    const seen = new Set<string>();
    while (file.mimeType === SHORTCUT) {
      if (!file.shortcutDetails || seen.has(file.id))
        throw new Error("Invalid or cyclic shortcut");
      seen.add(file.id);
      file = await this.get(file.shortcutDetails.targetId);
    }
    if (file.trashed) throw new Error("Source or destination is in the bin");
    return file;
  }
  async ensureSafeDestination(sources: DriveFile[], destination: DriveFile) {
    if (
      destination.mimeType !== FOLDER ||
      destination.capabilities?.canAddChildren === false
    )
      throw new Error("Destination must be a writable folder");
    const sourceIds = new Set(sources.map((f) => f.id));
    const queue = [destination.id];
    const seen = new Set<string>();
    while (queue.length) {
      const id = queue.pop()!;
      if (sourceIds.has(id))
        throw new Error(
          "Destination cannot be the source or inside a source folder",
        );
      if (seen.has(id)) continue;
      seen.add(id);
      if (seen.size > 200)
        throw new Error("Destination ancestry is too deep to validate safely");
      queue.push(...((await this.get(id)).parents ?? []));
    }
  }
  createFolder(name: string, parent: string, marker: string) {
    return this.request<DriveFile>(
      "files",
      { fields },
      {
        name,
        mimeType: FOLDER,
        parents: [parent],
        appProperties: { toolkit_folder: marker },
      },
    );
  }
  copy(sourceId: string, name: string, parent: string, marker: string) {
    return this.request<DriveFile>(
      `files/${encodeURIComponent(sourceId)}/copy`,
      { fields },
      {
        name,
        parents: [parent],
        appProperties: { toolkit_item: marker, toolkit_source: sourceId },
      },
    );
  }
}
