import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createApp, passwordHash } from "../server/app.ts";
import { HomeAssistantReadonlyAdapter } from "../server/adapters.ts";
import { homeSchema } from "../shared/model.ts";
import { demoHome } from "../shared/demo.ts";
const origin = "http://127.0.0.1:4185",
  password = "disposable-test-password-42";
let root: string, service: ReturnType<typeof createApp>;
const agent = () => request(service.app);
function get(url: string) {
  return agent().get(url).set("Host", "127.0.0.1:4185");
}
function post(url: string) {
  return agent().post(url).set("Host", "127.0.0.1:4185").set("Origin", origin).set("X-RediOnHome-Command-Protocol","2");
}
async function login(username = "owner") {
  const response = await post("/api/v1/login").send({ username, password });
  expect(response.status).toBe(200);
  return response.headers["set-cookie"][0].split(";")[0] as string;
}
beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "redionhome-unit-"));
  service = createApp({ root, origin, password, production: true });
  for (const id of ["atelier", "studio"]) {
    const dir = path.join(root, "media", id);
    mkdirSync(dir, { recursive: true });
    writeFileSync(path.join(dir, "manifest.json"), "{}");
    writeFileSync(path.join(dir, "preview.jpg"), "synthetic");
  }
  service.store.db
    .prepare("INSERT INTO users VALUES(?,?,?)")
    .run("viewer", passwordHash(password), "viewer");
});
afterEach(() => {
  service.store.close();
  rmSync(root, { recursive: true, force: true });
  vi.restoreAllMocks();
});
describe("authentication and private boundaries", () => {
  it("blocks unauthenticated configuration, devices and media", async () => {
    for (const url of [
      "/api/v1/home",
      "/api/v1/devices",
      "/api/v1/media/atelier/preview.jpg",
      "/api/v1/media/atelier/manifest",
    ])
      expect((await get(url)).status).toBe(401);
  });
  it("uses HttpOnly SameSite sessions and revokes on logout", async () => {
    const response = await post("/api/v1/login").send({ password });
    expect(response.headers["set-cookie"][0]).toContain("HttpOnly");
    expect(response.headers["set-cookie"][0]).toContain("SameSite=Strict");
    const cookie = response.headers["set-cookie"][0].split(";")[0];
    expect((await get("/api/v1/home").set("Cookie", cookie)).status).toBe(200);
    await post("/api/v1/logout").set("Cookie", cookie);
    expect((await get("/api/v1/home").set("Cookie", cookie)).status).toBe(401);
  });
  it("rejects missing or foreign origins and rebinding hosts", async () => {
    expect(
      (
        await agent()
          .post("/api/v1/login")
          .set("Host", "127.0.0.1:4185")
          .send({ password })
      ).status,
    ).toBe(403);
    expect(
      (
        await post("/api/v1/login")
          .set("Origin", "https://evil.example")
          .send({ password })
      ).status,
    ).toBe(403);
    expect(
      (await agent().get("/api/v1/health").set("Host", "evil.example")).status,
    ).toBe(403);
  });
  it("rejects incorrect credentials without issuing a session", async () => {
    const response = await post("/api/v1/login").send({ password: "wrong" });
    expect(response.status).toBe(401);
    expect(response.headers["set-cookie"]).toBeUndefined();
  });
  it("rejects an expired session", async () => {
    const cookie = await login();
    service.store.db.prepare("UPDATE sessions SET expires=0").run();
    expect((await get("/api/v1/home").set("Cookie", cookie)).status).toBe(401);
  });
  it("prevents viewers from writes, restores and commands", async () => {
    const cookie = await login("viewer");
    expect((await get("/api/v1/home").set("Cookie", cookie)).status).toBe(200);
    expect(
      (
        await agent()
          .put("/api/v1/home")
          .set("Host", "127.0.0.1:4185")
          .set("Origin", origin).set("X-RediOnHome-Command-Protocol","2")
          .set("Cookie", cookie)
          .send(demoHome)
      ).status,
    ).toBe(403);
    for (const url of ["/api/v1/commands", "/api/v1/restore"])
      expect((await post(url).set("Cookie", cookie).send({})).status).toBe(403);
  });
  it("never serves originals or arbitrary paths", async () => {
    const cookie = await login();
    expect(
      (await get("/api/v1/media/atelier/preview.jpg").set("Cookie", cookie))
        .status,
    ).toBe(200);
    for (const file of ["original", "manifest.json", "owner-password.txt"])
      expect(
        (await get(`/api/v1/media/atelier/${file}`).set("Cookie", cookie))
          .status,
      ).toBe(404);
  });
  it("sets security headers and disables API caching", async () => {
    const response = await get("/api/v1/health");
    expect(response.headers["content-security-policy"]).toContain(
      "frame-ancestors 'none'",
    );
    expect(response.headers["cache-control"]).toBe("no-store");
    expect(response.headers["x-content-type-options"]).toBe("nosniff");
  });
});
describe("revisioned configuration and fail-closed actions", () => {
  it("commits a version atomically, rejects stale revision and restores as a new revision", async () => {
    const cookie = await login();
    const put = (body: unknown) =>
      agent()
        .put("/api/v1/home")
        .set("Host", "127.0.0.1:4185")
        .set("Origin", origin).set("X-RediOnHome-Command-Protocol","2")
        .set("Cookie", cookie)
        .send(body as object);
    const candidate = { ...demoHome, name: "Changed home" };
    expect((await put(candidate)).body.revision).toBe(2);
    expect((await put(candidate)).status).toBe(409);
    const restored = await post("/api/v1/restore")
      .set("Cookie", cookie)
      .send({ revision: 1, expectedRevision: 2 });
    expect(restored.body.revision).toBe(3);
    expect(restored.body.name).toBe(demoHome.name);
    expect(
      service.store.db.prepare("SELECT count(*) as n FROM revisions").get(),
    ).toEqual({ n: 3 });
  });
  it("rejects invalid references and unknown media", async () => {
    expect(
      homeSchema.safeParse({
        ...demoHome,
        scenes: [{ ...demoHome.scenes[0], roomId: "missing" }],
      }).success,
    ).toBe(false);
    expect(
      homeSchema.safeParse({
        ...demoHome,
        objects: [...demoHome.objects, demoHome.objects[0]],
      }).success,
    ).toBe(false);
    const cookie = await login();
    const result = await agent()
      .put("/api/v1/home")
      .set("Host", "127.0.0.1:4185")
      .set("Origin", origin).set("X-RediOnHome-Command-Protocol","2")
      .set("Cookie", cookie)
      .send({
        ...demoHome,
        scenes: demoHome.scenes.map((s) => ({ ...s, mediaId: "unknown" })),
      });
    expect(result.status).toBe(400);
    expect(service.store.home().revision).toBe(1);
  });
  it("returns bounded validation paths without echoing invalid values", async () => {
    const cookie = await login();
    const invalid = structuredClone(demoHome);
    invalid.scenes[0].hotspots[0].position.yaw = 99;
    const result = await agent()
      .put("/api/v1/home")
      .set("Host", "127.0.0.1:4185")
      .set("Origin", origin).set("X-RediOnHome-Command-Protocol","2")
      .set("Cookie", cookie)
      .send(invalid);
    expect(result.status).toBe(400);
    expect(result.body).toEqual({
      error: "INVALID_INPUT",
      details: [{ path: "scenes.0.hotspots.0.position.yaw" }],
    });
    expect(JSON.stringify(result.body)).not.toContain("99");
    expect(service.store.home().revision).toBe(1);
  });
  it("commands only known mock bindings and records audit", async () => {
    const cookie = await login();
    const bad = await post("/api/v1/commands")
      .set("Cookie", cookie)
      .send({ objectId: "artwork", action: "turn_on" });
    expect(bad.status).toBe(403);
    const good = await post("/api/v1/commands")
      .set("Cookie", cookie)
      .send({ objectId: "light", action: "turn_on" });
    expect(good.status).toBe(200);
    expect(good.body.entities[0].state).toBe("on");
    expect(
      service.store.db
        .prepare("SELECT action FROM audit WHERE action='mock.command'")
        .get(),
    ).toEqual({ action: "mock.command" });
    expect(
      (
        await post("/api/v1/commands")
          .set("Cookie", cookie)
          .send({ objectId: "light", action: "unlock" })
      ).status,
    ).toBe(400);
  });
  it("rejects a config-injected binding without executing an adapter command", async () => {
    const spy = vi.spyOn(
      (await import("../server/adapters.ts")).MockAdapter.prototype,
      "command",
    );
    const home = service.store.home();
    home.objects.find((o) => o.id === "light")!.actions = [
      { type: "device", bindingId: "unapproved-lock" },
    ];
    service.store.save(home, "test");
    const cookie = await login();
    expect(
      (
        await post("/api/v1/commands")
          .set("Cookie", cookie)
          .send({ objectId: "light", action: "turn_on" })
      ).status,
    ).toBe(409);
    expect(spy).not.toHaveBeenCalled();
  });
  it("blocks real writes regardless of a configured object binding", async () => {
    const command = vi.fn();
    service.store.close();
    service = createApp({
      root,
      origin,
      password,
      adapter: {
        snapshot: async () => ({
          mode: "readonly",
          connection: "online",
          entities: [],
        }),
        command,
      },
    });
    const cookie = await login();
    expect(
      (
        await post("/api/v1/commands")
          .set("Cookie", cookie)
          .send({ objectId: "light", action: "turn_on" })
      ).status,
    ).toBe(403);
    expect(command).not.toHaveBeenCalled();
  });
  it("keeps configuration across store restart", () => {
    service.store.save({ ...demoHome, name: "Persisted" }, "test");
    service.store.close();
    service = createApp({ root, origin, password });
    expect(service.store.home().name).toBe("Persisted");
    expect(service.store.home().revision).toBe(2);
  });
});
describe("real adapter contract without contacting a home", () => {
  it("uses official REST states route and server-only bearer with no redirects", async () => {
    const tokenFile = path.join(root, "synthetic-token");
    writeFileSync(tokenFile, "synthetic-disposable-token");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(
        new Response(
          JSON.stringify([
            { entity_id: "light.test", state: "on", attributes: {} },
          ]),
          { status: 200 },
        ),
      );
    const adapter = new HomeAssistantReadonlyAdapter(
      "http://127.0.0.1:8123",
      tokenFile,
    );
    expect((await adapter.snapshot()).connection).toBe("online");
    expect(String(fetchMock.mock.calls[0][0])).toBe(
      "http://127.0.0.1:8123/api/states",
    );
    expect(fetchMock.mock.calls[0][1]?.redirect).toBe("error");
    expect(JSON.stringify(await adapter.snapshot())).not.toContain(
      "synthetic-disposable-token",
    );
    await expect(adapter.command()).rejects.toThrow(
      "REAL_COMMANDS_PHASE_2_LOCKED",
    );
  });
  it("marks malformed or failed upstream responses offline", async () => {
    const file = path.join(root, "synthetic-token");
    writeFileSync(file, "synthetic");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("{}", { status: 200 }),
    );
    const adapter = new HomeAssistantReadonlyAdapter(
      "http://127.0.0.1:8123",
      file,
    );
    expect((await adapter.snapshot()).connection).toBe("offline");
  });
});
it("serves validated private derivatives when DATA_DIR is a dot directory", async () => {
  service.store.close();
  const hidden = path.join(root, ".private");
  service = createApp({ root: hidden, origin, password });
  const dir = path.join(hidden, "media", "atelier");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "manifest.json"), "{}");
  writeFileSync(path.join(dir, "preview.jpg"), "synthetic-private");
  const cookie = await login();
  const response = await get("/api/v1/media/atelier/preview.jpg").set(
    "Cookie",
    cookie,
  );
  expect(response.status).toBe(200);
  expect(response.body.toString()).toBe("synthetic-private");
  expect(
    (await get("/api/v1/media/atelier/original").set("Cookie", cookie)).status,
  ).toBe(404);
});
