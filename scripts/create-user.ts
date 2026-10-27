import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { Store } from "../server/store.ts";
import { passwordHash } from "../server/app.ts";
const name = process.argv[2];
if (name !== "viewer")
  throw Error("Phase 1 supports: npm run user:create -- viewer");
const root = path.resolve(process.env.DATA_DIR ?? ".data"),
  store = new Store(root);
if (store.user(name)) throw Error("User already exists");
const password = randomBytes(24).toString("base64url");
writeFileSync(path.join(root, `${name}-password.txt`), password + "\n", {
  flag: "wx",
  mode: 0o600,
});
store.db
  .prepare("INSERT INTO users VALUES(?,?,?)")
  .run(name, passwordHash(password), "viewer");
store.audit("local-cli", "user.create", name);
store.close();
console.log(
  "Viewer created. Password is in DATA_DIR/viewer-password.txt; keep it private.",
);
