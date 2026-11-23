import type { IEngineContext, IModulusPlugin, ITrackSplineSchema } from '../../core/types';
import { buildTrackBundle, type IBuiltTrackBundle } from './buildTrackMesh';

class TrackGeneratorController implements IModulusPlugin {
  public readonly id = 'track-generator';
  public readonly version = '1.0.0';
  public readonly priority = 10;

  private ctx: IEngineContext | null = null;
  private activeBundle: IBuiltTrackBundle | null = null;
  private unsubs: Array<() => void> = [];

  public init(ctx: IEngineContext): void {
    this.ctx = ctx;
    this.rebuildTrack(ctx.getActiveTrack());

    this.unsubs.push(
      ctx.events.on('track:selected', ({ schema }) => {
        this.rebuildTrack(schema);
      }),
      ctx.events.on('mode:changed', ({ mode }) => {
        if (this.activeBundle) {
          this.activeBundle.group.visible = mode === 'track';
        }
      })
    );
  }

  private rebuildTrack(schema: ITrackSplineSchema): void {
    if (!this.ctx) return;

    if (this.activeBundle) {
      this.ctx.scene.remove(this.activeBundle.group);
      this.activeBundle.dispose();
      this.activeBundle = null;
    }

    const bundle = buildTrackBundle(schema);
    bundle.group.visible = this.ctx.getVisualMode() === 'track';
    this.ctx.scene.add(bundle.group);
    this.activeBundle = bundle;

    // Broadcast collision trimesh, walls, surface lookup & spawn transform to physics + engine
    this.ctx.setTrackGeometry(bundle.geometryData);
  }

  public dispose(): void {
    for (const unsub of this.unsubs) {
      unsub();
    }
    this.unsubs = [];

    if (this.activeBundle && this.ctx) {
      this.ctx.scene.remove(this.activeBundle.group);
      this.activeBundle.dispose();
      this.activeBundle = null;
    }
    this.ctx = null;
  }
}

export const trackGeneratorPlugin: IModulusPlugin = new TrackGeneratorController();
