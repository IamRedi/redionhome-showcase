import { readFileSync } from "node:fs";
import { z } from "zod";
import type { DeviceSnapshot } from "../shared/model.ts";
export interface DeviceAdapter {
  snapshot(): Promise<DeviceSnapshot>;
  command(bindingId: string, action: "turn_on" | "turn_off"): Promise<void>;
}
export class MockAdapter implements DeviceAdapter {
  private on = false;
  async snapshot(): Promise<DeviceSnapshot> {
    return {
      mode: "mock",
      connection: "online",
      entities: [
        {
          bindingId: "demo-light",
          name: "Drita e ateliesë",
          state: this.on ? "on" : "off",
          source: "mock",
          capabilities: ["power"],
        },
      ],
    };
  }
  async command(bindingId: string, action: "turn_on" | "turn_off") {
    if (bindingId !== "demo-light") throw Error("UNKNOWN_BINDING");
    this.on = action === "turn_on";
  }
}
const stateSchema = z.array(
  z.object({
    entity_id: z.string(),
    state: z.string(),
    attributes: z.record(z.string(), z.unknown()),
  }),
);
// Server-only, opt-in read-only REST boundary. Never instantiate from browser configuration.
export class HomeAssistantReadonlyAdapter implements DeviceAdapter {
  private readonly base: URL;
  private readonly token: string;
  constructor(url: string, tokenFile: string) {
    this.base = new URL(url);
    if (
      !["http:", "https:"].includes(this.base.protocol) ||
      this.base.username ||
      this.base.password ||
      this.base.pathname !== "/"
    )
      throw Error("Invalid HA origin");
    this.token = readFileSync(tokenFile, "utf8").trim();
    if (!this.token) throw Error("Missing server-side HA token");
  }
  async snapshot(): Promise<DeviceSnapshot> {
    try {
      const response = await fetch(new URL("/api/states", this.base), {
        headers: { Authorization: `Bearer ${this.token}` },
        redirect: "error",
        signal: AbortSignal.timeout(5000),
      });
      if (!response.ok) throw Error("HA_UNAVAILABLE");
      // Discovery only: browser receives no entity command binding automatically.
      stateSchema.parse(await response.json());
      return { mode: "readonly", connection: "online", entities: [] };
    } catch {
      return { mode: "readonly", connection: "offline", entities: [] };
    }
  }
  async command(): Promise<never> {
    throw Error("REAL_COMMANDS_PHASE_2_LOCKED");
  }
}
export const integrationCatalog = [
  {
    id: "piano-core",
    name: "Piano Core",
    status: "PLANNED",
    capabilities: ["external-view"],
    embedding: "requires-origin-and-frame-policy-verification",
  },
  {
    id: "led-wall",
    name: "LED Wall",
    status: "PLANNED",
    capabilities: ["external-view"],
    embedding: "requires-origin-and-frame-policy-verification",
  },
  {
    id: "bambu-lab",
    name: "Bambu Lab",
    status: "PLANNED",
    capabilities: ["status"],
    embedding: "not-configured",
  },
];
