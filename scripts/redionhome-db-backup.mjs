import Database from "better-sqlite3";
import { log } from "node:console";
import { createHash } from "node:crypto";
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

const dataDir = process.env.REDIONHOME_DATA_DIR;
const destinationDir = process.argv[2];
if (!dataDir || !path.isAbsolute(dataDir) || !destinationDir || !path.isAbsolute(destinationDir)) {
  throw new Error("REDIONHOME_DATA_DIR and the backup destination must be absolute paths");
}

const source = path.join(dataDir, "home.sqlite");
mkdirSync(destinationDir, { recursive: true, mode: 0o700 });
chmodSync(destinationDir, 0o700);
const destination = path.join(destinationDir, "home.sqlite");

const sourceDb = new Database(source, { readonly: true, fileMustExist: true });
const integrity = sourceDb.pragma("integrity_check", { simple: true });
const foreignKeyViolations = sourceDb.pragma("foreign_key_check").length;
const revision = sourceDb.prepare("SELECT revision FROM revisions ORDER BY revision DESC LIMIT 1").pluck().get();
const migrations = sourceDb.prepare("SELECT version FROM migrations ORDER BY version").pluck().all();
if (integrity !== "ok" || foreignKeyViolations !== 0) {
  sourceDb.close();
  throw new Error(`Active database preflight failed: integrity=${integrity}, foreignKeys=${foreignKeyViolations}`);
}
await sourceDb.backup(destination);
sourceDb.close();
chmodSync(destination, 0o600);

const backupDb = new Database(destination, { readonly: true, fileMustExist: true });
const backupIntegrity = backupDb.pragma("integrity_check", { simple: true });
const backupForeignKeys = backupDb.pragma("foreign_key_check").length;
backupDb.close();
if (backupIntegrity !== "ok" || backupForeignKeys !== 0) {
  throw new Error("Backup verification failed");
}

const sha256 = createHash("sha256").update(readFileSync(destination)).digest("hex");
const manifest = {
  createdAt: new Date().toISOString(),
  source,
  revision,
  migrations,
  integrity: backupIntegrity,
  foreignKeyViolations: backupForeignKeys,
  sha256,
  restorePolicy: "manual-only; automatic code rollback must never restore this database",
};
const manifestPath = path.join(destinationDir, "manifest.json");
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o600 });
chmodSync(manifestPath, 0o600);
log(JSON.stringify({ destination, revision, integrity: backupIntegrity, foreignKeyViolations: backupForeignKeys, sha256 }));
