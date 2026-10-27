#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
# One installer for the owner-authorized original private runtime.
# Arguments are explicit, including the expected pointer. Never choose "latest".
[[ $# == 4 ]] || { echo "Usage: $0 EXPECTED_RELEASE CANDIDATE DATA_DIR NEW_BACKUP_DIR" >&2; exit 2; }
expected="$(realpath -e "$1")"
candidate="$(realpath -e "$2")"
data_dir="$(realpath -e "$3")"
backup="$4"
release_root="$(dirname "$expected")"
[[ "$candidate" != "$expected" && "$(dirname "$candidate")" == "$release_root" && "$backup" == /* && ! -e "$backup" ]] || { echo "Invalid installation paths" >&2; exit 1; }
mkdir -p "$release_root/.updater-state"
exec 9>"$release_root/.updater-state/update.lock"
flock -n 9 || { echo "Another installation holds the lock" >&2; exit 1; }
assert_pointer() {
  [[ "$(readlink -f "$release_root/current")" == "$1" ]] || { echo "Release pointer changed; refusing to overwrite another session" >&2; exit 1; }
}
assert_pointer "$expected"
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"
node --import tsx "$project_dir/scripts/verify-release-source.ts" "$candidate"
node "$project_dir/scripts/release-files.mjs" "$expected" "$candidate"
# Full private backup plus consistent SQLite snapshot; never restore it automatically.
mkdir -m 700 "$backup"
node "$project_dir/scripts/copy-private-data.mjs" "$data_dir" "$backup/data"
REDIONHOME_DATA_DIR="$data_dir" node "$project_dir/scripts/redionhome-db-backup.mjs" "$backup"
node "$project_dir/scripts/verify-install-backup.mjs" "$data_dir" "$backup" "$candidate"
assert_pointer "$expected"
ln -s "$candidate" "$release_root/.current.$$.tmp"
mv -Tf "$release_root/.current.$$.tmp" "$release_root/current"
service="${REDIONHOME_SERVICE:-redionhome-m4b.service}"
health="${REDIONHOME_HEALTH_URL:-http://127.0.0.1:4173/api/v1/health}"
build_url="${health%/api/v1/health}/build.json"
rollback() {
  # A non-cooperating session may still have changed current. Never overwrite it.
  assert_pointer "$candidate"
  # Retain new code for tabs opened during the failed install, too.
  node --input-type=module -e 'import {retainAssets} from "./scripts/release-files.mjs"; retainAssets(process.argv[1],process.argv[2]);' "$candidate" "$expected"
  ln -s "$expected" "$release_root/.rollback.$$.tmp"
  mv -Tf "$release_root/.rollback.$$.tmp" "$release_root/current"
  systemctl --user restart "$service"
  echo "Code rolled back; database was not restored" >&2
}
cd "$project_dir"
trap 'rollback' ERR
systemctl --user restart "$service"
healthy=no
for _attempt in {1..20}; do
  if curl --fail --silent "$health" >/dev/null && curl --fail --silent "$build_url" | cmp -s - "$candidate/dist/build.json"; then healthy=yes; break; fi
  sleep 0.5
done
[[ "$healthy" == yes ]]
assert_pointer "$candidate"
trap - ERR
printf '%s\n' "$candidate" > "$release_root/.updater-state/last-successful-release"
echo "Installed verified private release; full backup retained"
