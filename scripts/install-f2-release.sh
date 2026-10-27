#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
# This explicit migration gate is used only after the owner's schema-8 approval.
[[ $# == 5 && "$5" == --migrate-7-to-8 ]] || { echo 'Usage: install-f2-release.sh EXPECTED CANDIDATE DATA_DIR NEW_BACKUP_DIR --migrate-7-to-8 (requires owner approval)' >&2; exit 2; }
expected="$(realpath -e "$1")"
candidate="$(realpath -e "$2")"
data_dir="$(realpath -e "$3")"
backup="$4"
release_root="$(dirname "$expected")"
[[ "$candidate" != "$expected" && "$(dirname "$candidate")" == "$release_root" && "$backup" == /* && ! -e "$backup" ]] || { echo 'Invalid F2 installation paths' >&2; exit 1; }
mkdir -p "$release_root/.updater-state"
exec 9>"$release_root/.updater-state/update.lock"
flock -n 9 || { echo 'Another installation holds the lock' >&2; exit 1; }
project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$project_dir"
assert_pointer(){ [[ "$(readlink -f "$release_root/current")" == "$1" ]] || { echo 'Release pointer changed; refusing overwrite' >&2; exit 1; }; }
assert_pointer "$expected"
node --import tsx scripts/verify-release-source.ts "$expected"
node --import tsx scripts/verify-release-source.ts "$candidate"
node scripts/release-files.mjs "$expected" "$candidate"
service="${REDIONHOME_SERVICE:-redionhome-m4b.service}"
health="${REDIONHOME_HEALTH_URL:-http://127.0.0.1:4173/api/v1/health}"
recover(){
  local current
  current="$(readlink -f "$release_root/current")"
  if [[ "$current" == "$candidate" ]]; then
    node --input-type=module -e 'import {retainAssets} from "./scripts/release-files.mjs";retainAssets(process.argv[1],process.argv[2]);' "$candidate" "$expected"
    ln -s "$expected" "$release_root/.f2-rollback.$$.tmp"
    mv -Tf "$release_root/.f2-rollback.$$.tmp" "$release_root/current"
  elif [[ "$current" != "$expected" ]]; then
    echo 'Pointer changed outside installer; refusing rollback overwrite or restart' >&2
    return 1
  fi
  systemctl --user restart "$service"
  echo 'F1 code restored/restarted; active database was not restored' >&2
}
trap 'recover' ERR
systemctl --user stop "$service"
# With the old writer stopped, the backup includes every committed owner edit.
mkdir -m 700 "$backup"
node scripts/copy-private-data.mjs "$data_dir" "$backup/data"
REDIONHOME_DATA_DIR="$data_dir" node scripts/redionhome-db-backup.mjs "$backup"
node scripts/verify-install-backup.mjs "$data_dir" "$backup" "$candidate" --schema-7-to-8
node --import tsx scripts/migrate-f2.ts rehearse "$candidate" "$expected" "$backup/home.sqlite" "$backup/migration-rehearsal"
assert_pointer "$expected"
node --import tsx scripts/migrate-f2.ts apply "$candidate" "$expected" "$data_dir" "$backup/migration-rehearsal/evidence.json"
assert_pointer "$expected"
ln -s "$candidate" "$release_root/.f2-current.$$.tmp"
mv -Tf "$release_root/.f2-current.$$.tmp" "$release_root/current"
systemctl --user restart "$service"
healthy=no
for _attempt in {1..20}; do
  if curl --fail --silent "$health" >/dev/null && curl --fail --silent "${health%/api/v1/health}/build.json" | cmp -s - "$candidate/dist/build.json"; then healthy=yes; break; fi
  sleep 0.5
done
[[ "$healthy" == yes ]]
assert_pointer "$candidate"
trap - ERR
printf '%s\n' "$candidate" > "$release_root/.updater-state/last-successful-release"
echo 'F2 installed after verified schema rehearsal and full backup; no device permissions were created'
