import Database from "better-sqlite3";
import { mkdirSync, chmodSync } from "node:fs";
import path from "node:path";
import { demoHome } from "../shared/demo.ts";
import { homeSchema, type Home, type Role } from "../shared/model.ts";
export class Store {
  readonly db: Database.Database;
  constructor(root: string) {
    mkdirSync(root, { recursive: true, mode: 0o700 });
    chmodSync(root, 0o700);
    this.db = new Database(path.join(root, "home.sqlite"));
    chmodSync(path.join(root, "home.sqlite"), 0o600);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    // Numbered, transactional migrations; never recreate an existing database.
    this.db.transaction(() => {
      this.db.exec(
        "CREATE TABLE IF NOT EXISTS migrations(version INTEGER PRIMARY KEY)",
      );
      if (!this.db.prepare("SELECT 1 FROM migrations WHERE version=1").get()) {
        this.db
          .exec(`CREATE TABLE users(id TEXT PRIMARY KEY, password_hash TEXT NOT NULL, role TEXT NOT NULL CHECK(role IN ('owner','viewer')));
 CREATE TABLE sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES users(id),expires INTEGER NOT NULL);
 CREATE TABLE revisions(revision INTEGER PRIMARY KEY,document TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 CREATE TABLE audit(id INTEGER PRIMARY KEY,actor TEXT NOT NULL,action TEXT NOT NULL,detail TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
 INSERT INTO migrations VALUES(1);`);
        this.db
          .prepare("INSERT INTO revisions(revision,document) VALUES(?,?)")
          .run(1, JSON.stringify(demoHome));
      }
    })();
    this.db.transaction(() => {
      if (!this.db.prepare("SELECT 1 FROM migrations WHERE version=2").get()) {
        this.db.exec(`
          CREATE TABLE access(user_id TEXT PRIMARY KEY REFERENCES users(id), role TEXT NOT NULL CHECK(role IN ('household','invited_guest')), label TEXT NOT NULL, grant_json TEXT NOT NULL, expires INTEGER NOT NULL, revoked INTEGER NOT NULL DEFAULT 0, max_sessions INTEGER NOT NULL);
          CREATE TABLE invitations(token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES access(user_id));
          CREATE TABLE publications(id TEXT PRIMARY KEY, title TEXT NOT NULL, audience TEXT NOT NULL CHECK(audience IN ('invited','public')), source_revision INTEGER NOT NULL, document TEXT NOT NULL, approved INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
          CREATE TABLE exposure(audience TEXT PRIMARY KEY CHECK(audience IN ('invited','public')), publication_id TEXT REFERENCES publications(id));
          INSERT INTO exposure VALUES('invited',NULL),('public',NULL);
          INSERT INTO migrations VALUES(2);
        `);
      }
    })();
    this.db.transaction(()=>{
      if(!this.db.prepare('SELECT 1 FROM migrations WHERE version=3').get()){
        this.db.exec(`CREATE TABLE photo_suggestions(id TEXT PRIMARY KEY,document TEXT NOT NULL,source_revision INTEGER NOT NULL,confirmed_json TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP); INSERT INTO migrations VALUES(3);`);
      }
    })();
    this.db.transaction(()=>{
      if(!this.db.prepare('SELECT 1 FROM migrations WHERE version=4').get()){
        this.db.exec(`CREATE TABLE ha_connection(id INTEGER PRIMARY KEY CHECK(id=1),origin TEXT NOT NULL);
          CREATE TABLE ha_bindings(binding_id TEXT PRIMARY KEY,object_id TEXT NOT NULL UNIQUE,entity_id TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
          INSERT INTO migrations VALUES(4);`);
      }
    })();
    this.db.transaction(()=>{
      if(!this.db.prepare('SELECT 1 FROM migrations WHERE version=5').get()){
        this.db.exec(`CREATE TABLE canonical_devices(
          id TEXT PRIMARY KEY, object_id TEXT NOT NULL UNIQUE, primary_provider TEXT NOT NULL,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
          CREATE TABLE provider_identities(
          provider TEXT NOT NULL, external_id TEXT NOT NULL, device_id TEXT NOT NULL REFERENCES canonical_devices(id) ON DELETE CASCADE,
          confirmed_by TEXT NOT NULL, confirmed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY(provider,external_id), UNIQUE(device_id,provider));
          INSERT INTO migrations VALUES(5);`);
        const rows=this.db.prepare('SELECT object_id,entity_id FROM ha_bindings').all() as {object_id:string;entity_id:string}[];
        for(const row of rows){
          const deviceId=`device-${row.object_id}`;
          this.db.prepare('INSERT INTO canonical_devices(id,object_id,primary_provider) VALUES(?,?,?)').run(deviceId,row.object_id,'home-assistant');
          this.db.prepare('INSERT INTO provider_identities(provider,external_id,device_id,confirmed_by) VALUES(?,?,?,?)').run('home-assistant',row.entity_id,deviceId,'m4a-migration');
        }
      }
    })();
    this.db.transaction(()=>{
      if(!this.db.prepare('SELECT 1 FROM migrations WHERE version=6').get()){
        // Existing links were created in the read-only pilot. Keep them read-only.
        this.db.exec('ALTER TABLE ha_bindings ADD COLUMN control_enabled INTEGER NOT NULL DEFAULT 0 CHECK(control_enabled IN (0,1)); INSERT INTO migrations VALUES(6);');
      }
    })();
    this.db.transaction(()=>{
      if(!this.db.prepare('SELECT 1 FROM migrations WHERE version=7').get()){
        this.db.exec(`CREATE TABLE unified_devices(
          provider TEXT NOT NULL CHECK(provider IN ('home-assistant','smartthings','tuya')),
          external_id TEXT NOT NULL,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          capabilities_json TEXT NOT NULL,
          command_capabilities_json TEXT NOT NULL,
          state TEXT NOT NULL,
          availability TEXT NOT NULL CHECK(availability IN ('online','offline','unavailable','unknown')),
          values_json TEXT NOT NULL,
          observed_at TEXT,
          room TEXT,
          reason TEXT,
          last_seen_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY(provider,external_id));
          CREATE INDEX unified_devices_category ON unified_devices(category);
          INSERT INTO migrations VALUES(7);`);
      }
    })();
    /** F2 schema is additive; old home documents/bindings remain untouched. */
    this.db.transaction(()=>{
      if(!this.db.prepare('SELECT 1 FROM migrations WHERE version=8').get()){
        this.db.exec(`
          CREATE TABLE action_policies(actor TEXT PRIMARY KEY,version INTEGER NOT NULL,mode TEXT NOT NULL,duration TEXT NOT NULL,session_hash TEXT,grants_json TEXT NOT NULL,updated_at TEXT NOT NULL);
          CREATE TABLE action_runs(id TEXT PRIMARY KEY,actor TEXT NOT NULL,request_id TEXT NOT NULL,request_hash TEXT NOT NULL,session_hash TEXT NOT NULL,source TEXT NOT NULL,channel TEXT NOT NULL,status TEXT NOT NULL,policy_version INTEGER NOT NULL,ambient_id TEXT,ambient_version INTEGER,failure_mode TEXT NOT NULL,expires_at INTEGER NOT NULL,stop_requested INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL,ended_at TEXT,UNIQUE(actor,request_id));
          CREATE TABLE action_steps(run_id TEXT NOT NULL REFERENCES action_runs(id),step_index INTEGER NOT NULL,document TEXT NOT NULL,PRIMARY KEY(run_id,step_index));
          CREATE TABLE action_events(id INTEGER PRIMARY KEY,run_id TEXT NOT NULL REFERENCES action_runs(id),step_index INTEGER,actor TEXT NOT NULL,executor TEXT NOT NULL,channel TEXT NOT NULL,provider TEXT,object_id TEXT,room_id TEXT,phase TEXT NOT NULL,policy_version INTEGER NOT NULL,detail_json TEXT NOT NULL,created_at TEXT NOT NULL);
          CREATE INDEX action_events_run ON action_events(run_id,id);
          CREATE TABLE ambients(id TEXT NOT NULL,version INTEGER NOT NULL,document TEXT NOT NULL,actor TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(id,version));
          CREATE TABLE ai_requests(actor TEXT NOT NULL,request_id TEXT NOT NULL,request_hash TEXT NOT NULL,session_hash TEXT NOT NULL,status TEXT NOT NULL,result_json TEXT,usage_json TEXT,created_at TEXT NOT NULL,PRIMARY KEY(actor,request_id));
          CREATE TABLE action_stops(actor TEXT NOT NULL,request_id TEXT NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(actor,request_id));
          CREATE TABLE action_identity_epochs(object_id TEXT PRIMARY KEY,generation INTEGER NOT NULL);
          CREATE TRIGGER action_ha_bindings_insert AFTER INSERT ON ha_bindings BEGIN INSERT INTO action_identity_epochs VALUES(NEW.object_id,1) ON CONFLICT(object_id) DO UPDATE SET generation=generation+1; END;
          CREATE TRIGGER action_ha_bindings_update AFTER UPDATE ON ha_bindings BEGIN INSERT INTO action_identity_epochs VALUES(OLD.object_id,1) ON CONFLICT(object_id) DO UPDATE SET generation=generation+1; INSERT INTO action_identity_epochs VALUES(NEW.object_id,1) ON CONFLICT(object_id) DO UPDATE SET generation=generation+1; END;
          CREATE TRIGGER action_ha_bindings_delete AFTER DELETE ON ha_bindings BEGIN INSERT INTO action_identity_epochs VALUES(OLD.object_id,1) ON CONFLICT(object_id) DO UPDATE SET generation=generation+1; END;
          CREATE TRIGGER action_canonical_devices_insert AFTER INSERT ON canonical_devices BEGIN INSERT INTO action_identity_epochs VALUES(NEW.object_id,1) ON CONFLICT(object_id) DO UPDATE SET generation=generation+1; END;
          CREATE TRIGGER action_canonical_devices_update AFTER UPDATE ON canonical_devices BEGIN INSERT INTO action_identity_epochs VALUES(OLD.object_id,1) ON CONFLICT(object_id) DO UPDATE SET generation=generation+1; INSERT INTO action_identity_epochs VALUES(NEW.object_id,1) ON CONFLICT(object_id) DO UPDATE SET generation=generation+1; END;
          CREATE TRIGGER action_canonical_devices_delete AFTER DELETE ON canonical_devices BEGIN INSERT INTO action_identity_epochs VALUES(OLD.object_id,1) ON CONFLICT(object_id) DO UPDATE SET generation=generation+1; END;
          INSERT INTO migrations VALUES(8);
        `);
      }
    })();
  }
  home(): Home {
    const row = this.db
      .prepare("SELECT document FROM revisions ORDER BY revision DESC LIMIT 1")
      .get() as { document: string };
    return homeSchema.parse(JSON.parse(row.document));
  }
  audit(actor: string, action: string, detail: string) {
    this.db
      .prepare("INSERT INTO audit(actor,action,detail) VALUES(?,?,?)")
      .run(actor, action, detail);
  }
  save(candidate: Home, actor: string): Home {
    return this.db.transaction(() => {
      const current = this.home();
      if (candidate.revision !== current.revision)
        throw Error("REVISION_CONFLICT");
      const next = homeSchema.parse({
        ...candidate,
        revision: current.revision + 1,
      });
      this.validateBindings(next);
      this.db
        .prepare("INSERT INTO revisions(revision,document) VALUES(?,?)")
        .run(next.revision, JSON.stringify(next));
      this.audit(actor, "config.save", String(next.revision));
      return next;
    })();
  }
  validateBindings(next: Home) {
      const bindings=this.db.prepare('SELECT binding_id,object_id FROM ha_bindings').all() as {binding_id:string;object_id:string}[];
      for(const binding of bindings){
        const object=next.objects.find(o=>o.id===binding.object_id);
        if(!object||object.provider?.active!=='home-assistant'||!object.actions.some(a=>a.type==='device'&&a.bindingId===binding.binding_id)||!next.scenes.some(s=>s.hotspots.some(h=>h.objectId===binding.object_id)))throw Error('HA_BINDING_MANAGED');
      }
      const external=this.db.prepare("SELECT id,object_id,primary_provider FROM canonical_devices WHERE primary_provider IN ('smartthings','tuya')").all() as {id:string;object_id:string;primary_provider:string}[];
      for(const device of external){
        const object=next.objects.find(o=>o.id===device.object_id);
        if(!object||object.provider?.active!==device.primary_provider||!object.actions.some(a=>a.type==='device'&&a.bindingId===device.id)||!next.scenes.some(s=>s.hotspots.some(h=>h.objectId===device.object_id)))throw Error('EXTERNAL_BINDING_MANAGED');
      }
  }
  user(id: string) {
    return this.db
      .prepare("SELECT id,password_hash,role FROM users WHERE id=?")
      .get(id) as { id: string; password_hash: string; role: Role } | undefined;
  }
  close() {
    this.db.close();
  }
}
