import "server-only";
import fs from "node:fs/promises";
import path from "node:path";
import net from "node:net";
import { createClient } from "@supabase/supabase-js";
import { env } from "@/lib/env";

export interface ObjectStore {
  put(key: string, body: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
}

class LocalStore implements ObjectStore {
  constructor(private root: string) {}
  private full(key: string) {
    const p = path.resolve(this.root, key);
    if (!p.startsWith(path.resolve(this.root) + path.sep)) throw new Error("Invalid storage key");
    return p;
  }
  async put(key: string, body: Buffer) {
    const p = this.full(key);
    await fs.mkdir(path.dirname(p), { recursive: true });
    await fs.writeFile(p, body, { mode: 0o600 });
  }
  async get(key: string) { return fs.readFile(this.full(key)); }
  async remove(key: string) { await fs.rm(this.full(key), { force: true }); }
}

class SupabaseStore implements ObjectStore {
  private bucket = "audit-files";
  private client = createClient(env().NEXT_PUBLIC_SUPABASE_URL!, env().SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  async put(key: string, body: Buffer, contentType: string) {
    const { error } = await this.client.storage.from(this.bucket).upload(key, body, { contentType, upsert: false });
    if (error) throw new Error(`Storage upload failed: ${error.message}`);
  }
  async get(key: string) {
    const { data, error } = await this.client.storage.from(this.bucket).download(key);
    if (error || !data) throw new Error(`Storage download failed: ${error?.message}`);
    return Buffer.from(await data.arrayBuffer());
  }
  async remove(key: string) { await this.client.storage.from(this.bucket).remove([key]); }
}

let store: ObjectStore | null = null;
export function objectStore(): ObjectStore {
  if (!store) store = env().STORAGE_PROVIDER === "supabase" ? new SupabaseStore() : new LocalStore(path.resolve(env().LOCAL_STORAGE_DIR));
  return store;
}

// ---------------------------------------------------------------------------
// Upload safety: type allow-list by extension AND content signature, size limit, malware scan.
// ---------------------------------------------------------------------------
const ALLOWED: Record<string, string> = {
  ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  ".csv": "text/csv",
  ".json": "application/json",
  ".pdf": "application/pdf",
  ".txt": "text/plain",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".zip": "application/zip",
};

export function inspectUpload(fileName: string, body: Buffer): { ok: true; mime: string } | { ok: false; reason: string } {
  const ext = path.extname(fileName).toLowerCase();
  const mime = ALLOWED[ext];
  if (!mime) return { ok: false, reason: `File type ${ext || "(none)"} is not permitted` };
  if (body.length === 0) return { ok: false, reason: "File is empty" };
  if (body.length > env().MAX_UPLOAD_MB * 1024 * 1024) return { ok: false, reason: `File exceeds ${env().MAX_UPLOAD_MB} MB` };
  const head = body.subarray(0, 8);
  const isZip = head[0] === 0x50 && head[1] === 0x4b;
  if ([".xlsx", ".docx", ".zip"].includes(ext) && !isZip) return { ok: false, reason: "File content does not match its extension" };
  if (ext === ".pdf" && head.toString("latin1", 0, 5) !== "%PDF-") return { ok: false, reason: "File content is not a PDF" };
  if (ext === ".png" && head.readUInt32BE(0) !== 0x89504e47) return { ok: false, reason: "File content is not a PNG" };
  if ((ext === ".jpg" || ext === ".jpeg") && !(head[0] === 0xff && head[1] === 0xd8)) return { ok: false, reason: "File content is not a JPEG" };
  if ([".csv", ".json", ".txt"].includes(ext) && body.subarray(0, 65536).includes(0)) return { ok: false, reason: "Text file contains binary content" };
  return { ok: true, mime };
}

/** clamd INSTREAM scan when CLAMAV_HOST is configured. */
export async function scanForMalware(body: Buffer): Promise<"clean" | "infected" | "skipped" | "error"> {
  const host = env().CLAMAV_HOST;
  if (!host) return "skipped";
  const [h, p] = host.split(":");
  return new Promise((resolve) => {
    const sock = net.connect(Number(p ?? 3310), h);
    let reply = "";
    sock.setTimeout(30_000, () => { sock.destroy(); resolve("error"); });
    sock.on("error", () => resolve("error"));
    sock.on("data", (d) => (reply += d.toString()));
    sock.on("end", () => resolve(/OK\s*$/.test(reply.replace(/\0/g, "")) ? "clean" : /FOUND/.test(reply) ? "infected" : "error"));
    sock.write("zINSTREAM\0");
    for (let i = 0; i < body.length; i += 64 * 1024) {
      const chunk = body.subarray(i, i + 64 * 1024);
      const len = Buffer.alloc(4); len.writeUInt32BE(chunk.length);
      sock.write(len); sock.write(chunk);
    }
    sock.end(Buffer.alloc(4));
  });
}

export function safeFileName(name: string): string {
  return name.normalize("NFKD").replace(/[^\w.\- ]+/g, "_").replace(/\s+/g, "_").slice(-120);
}

/**
 * Direct-to-storage upload for large files (bypasses the 4.5 MB serverless request limit).
 * Returns null for local storage, where the browser posts the file to the server instead.
 */
export async function createSignedUpload(key: string): Promise<{ url: string; token: string; key: string } | null> {
  if (env().STORAGE_PROVIDER !== "supabase") return null;
  const client = createClient(env().NEXT_PUBLIC_SUPABASE_URL!, env().SUPABASE_SERVICE_ROLE_KEY!, { auth: { persistSession: false } });
  const { data, error } = await client.storage.from("audit-files").createSignedUploadUrl(key);
  if (error || !data) throw new Error(`Could not prepare upload: ${error?.message}`);
  return { url: data.signedUrl, token: data.token, key };
}
