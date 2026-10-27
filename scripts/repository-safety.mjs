import { execFileSync } from "node:child_process";
import { error, log } from "node:console";
import { readFileSync } from "node:fs";
import process from "node:process";

const tracked = execFileSync("git", ["ls-files", "-z"], {
  encoding: "buffer",
})
  .toString("utf8")
  .split("\0")
  .filter(Boolean);

const allowedPaths = new Set([".env.example", "public/icon-192.png", "public/icon-512.png"]);
const blockedPath = /(^|\/)(?:\.data|\.test-data|backups?|releases?|test-results|playwright-report|\.tailscale|tailscale-state)(?:\/|$)|(^|\/)\.env(?:\.|$)|\.(?:sqlite(?:-.+)?|db(?:-.+)?|pem|key|p12|pfx|jpe?g|webp|tiff?|mp4|mov|pdf|tar|tgz|gz|zip)$/i;
const secretPatterns = [
  [/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/, "private key"],
  [/\bgh[pousr]_[A-Za-z0-9_]{20,}\b/, "GitHub token"],
  [/\bgithub_pat_[A-Za-z0-9_]{20,}\b/, "GitHub fine-grained token"],
  [/\btskey-[A-Za-z0-9-]{20,}\b/, "Tailscale key"],
];

const findings = [];
for (const file of tracked) {
  if (blockedPath.test(file) && !allowedPaths.has(file)) {
    findings.push(`${file}: blocked private/binary path`);
    continue;
  }
  const body = readFileSync(file);
  if (body.length > 2_000_000 || body.includes(0)) continue;
  const text = body.toString("utf8");
  for (const [pattern, label] of secretPatterns) {
    if (pattern.test(text)) findings.push(`${file}: possible ${label}`);
  }
}

if (findings.length) {
  error("Repository safety check failed:\n" + findings.map((item) => `- ${item}`).join("\n"));
  process.exit(1);
}

log(`Repository safety check passed (${tracked.length} tracked files).`);
