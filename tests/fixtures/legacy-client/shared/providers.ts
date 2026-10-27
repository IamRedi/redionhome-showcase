import type { DeviceCapability } from './device-catalog.ts';
export type ProviderId = 'mock' | 'home-assistant' | 'smartthings' | 'tuya' | 'matter' | 'mqtt' | 'vendor' | 'piano-core' | 'led-wall' | 'bambu-lab' | 'hugo';
export type Capability = DeviceCapability;
export type ProviderAvailability = 'online' | 'offline' | 'unconfigured';
export type DiscoveredDevice = {
    identity: string;
    provider: ProviderId;
    binding: string;
    capabilities: Capability[];
};
export type ProviderState = {
    identity: string;
    availability: ProviderAvailability;
    values: Record<string, string | number | boolean>;
    observedAt: number;
};
// Authentication stays in server-owned configuration, never the object/showroom DTO.
export interface UniversalProvider {
    id: ProviderId;
    kind: 'mock' | 'physical';
    discover(): Promise<DiscoveredDevice[]>;
    state(binding: string): Promise<ProviderState>;
    availability(): Promise<ProviderAvailability>;
    authenticate(): Promise<boolean>;
    reconnect(signal: AbortSignal): Promise<void>;
    action(binding: string, capability: Capability, value: unknown): Promise<void>;
}
