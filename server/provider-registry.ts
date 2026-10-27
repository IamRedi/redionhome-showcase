import type { Capability, DiscoveredDevice, ProviderId, UniversalProvider } from '../shared/providers.ts';
// Server-owned canonical identity selects exactly one provider per device.
export class ProviderRegistry {
    private providers = new Map<ProviderId, UniversalProvider>();
    private bindings = new Map<string, DiscoveredDevice>();
    private inFlight = new Set<string>();
    constructor(private audit: (event: string, identity: string) => void) { }
    register(provider: UniversalProvider) { if (this.providers.has(provider.id))
        throw Error('DUPLICATE_PROVIDER'); this.providers.set(provider.id, provider); }
    select(binding: DiscoveredDevice) { if (!this.providers.has(binding.provider))
        throw Error('UNKNOWN_PROVIDER'); if (this.inFlight.has(binding.identity))
        throw Error('DEVICE_BUSY'); this.bindings.set(binding.identity, binding); }
    async action(identity: string, provider: ProviderId, capability: Capability, value: unknown, authorized: boolean) {
        if (!authorized)
            throw Error('ACTION_NOT_ALLOWED');
        const binding = this.bindings.get(identity);
        if (!binding || binding.provider !== provider)
            throw Error('INACTIVE_PROVIDER');
        const adapter = this.providers.get(provider)!;
        if (adapter.kind !== 'mock')
            throw Error('PHYSICAL_COMMANDS_LOCKED');
        if (!binding.capabilities.includes(capability))
            throw Error('UNSUPPORTED_CAPABILITY');
        if (this.inFlight.has(identity))
            throw Error('DEVICE_BUSY');
        this.inFlight.add(identity);
        try {
            if (!await adapter.authenticate() || await adapter.availability() !== 'online')
                throw Error('DEVICE_UNAVAILABLE');
            await adapter.action(binding.binding, capability, value);
            this.audit('mock.action', identity);
        }
        finally {
            this.inFlight.delete(identity);
        }
    }
}
export const providerCatalog = ['mock', 'home-assistant', 'smartthings', 'tuya', 'matter', 'mqtt', 'vendor', 'piano-core', 'led-wall', 'bambu-lab', 'hugo'].map(id => ({ id, status: id === 'mock' ? 'MOCK' : id === 'home-assistant' ? 'PILOT' : id === 'smartthings' || id === 'tuya' ? 'AUTH_BLOCKED' : 'PLANNED', physicalCommands: id === 'home-assistant' ? 'EXACT_LIGHT_APPROVAL_REQUIRED' : false }));
