import type {
  ICompiledVehicle,
  IEngineContext,
  IGlobalBalanceConfig,
  IInputState,
  IModulusPlugin,
  IVehicleRuntimeState,
} from './types';

export class PluginRegistry {
  private plugins: IModulusPlugin[] = [];
  private initialized = false;

  public register(plugin: IModulusPlugin): void {
    const existingIdx = this.plugins.findIndex((p) => p.id === plugin.id);
    if (existingIdx >= 0) {
      this.plugins[existingIdx] = plugin;
    } else {
      this.plugins.push(plugin);
    }
    this.plugins.sort((a, b) => a.priority - b.priority);
  }

  public registerAll(plugins: IModulusPlugin[]): void {
    for (const p of plugins) {
      this.register(p);
    }
  }

  public unregister(pluginId: string): void {
    const idx = this.plugins.findIndex((p) => p.id === pluginId);
    if (idx >= 0) {
      const [removed] = this.plugins.splice(idx, 1);
      removed.dispose?.();
    }
  }

  public getPlugins(): readonly IModulusPlugin[] {
    return this.plugins;
  }

  public async initAll(ctx: IEngineContext): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    for (const plugin of this.plugins) {
      await plugin.init(ctx);
    }
  }

  public notifyBalanceConfig(config: IGlobalBalanceConfig): void {
    for (const plugin of this.plugins) {
      plugin.onBalanceConfigUpdated?.(config);
    }
  }

  public notifyBuildCompiled(vehicle: ICompiledVehicle): void {
    for (const plugin of this.plugins) {
      plugin.onBuildCompiled?.(vehicle);
    }
  }

  public stepPhysics(dt: number, state: IVehicleRuntimeState, input: IInputState): void {
    for (let i = 0; i < this.plugins.length; i++) {
      this.plugins[i].onPhysicsStep?.(dt, state, input);
    }
  }

  public renderAll(alpha: number, state: IVehicleRuntimeState): void {
    for (let i = 0; i < this.plugins.length; i++) {
      this.plugins[i].onRender?.(alpha, state);
    }
  }

  public disposeAll(): void {
    for (let i = this.plugins.length - 1; i >= 0; i--) {
      this.plugins[i].dispose?.();
    }
    this.initialized = false;
  }
}
