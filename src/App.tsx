import { useEffect, useMemo, useRef, useState } from 'react';
import { ModulusEngine } from './core/Engine';
import { StorageSync } from './core/StorageSync';
import { ACTIVE_PLUGINS } from './plugins/registry';
import { AdminPanel } from './ui/admin';
import { AuthModal } from './ui/auth';
import { AppShell } from './ui/AppShell';

export function App() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pathname, setPathname] = useState<string>(() => window.location.pathname);

  const engine = useMemo(() => new ModulusEngine(ACTIVE_PLUGINS), []);
  const storage = useMemo(() => new StorageSync(engine.events), [engine]);

  useEffect(() => {
    const onPopState = () => setPathname(window.location.pathname);
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    let active = true;
    void storage.bootstrap().then(({ garage, balanceConfig }) => {
      if (!active) return;
      engine.setBalanceConfig(balanceConfig);
      engine.updateBuild(garage.activeBuild);
      engine.selectTrack(garage.selectedTrackId);
    });

    const unsubConfig = engine.events.on('config:updated', ({ config }) => {
      if (engine.getBalanceConfig().version_id !== config.version_id) {
        engine.setBalanceConfig(config);
      }
    });

    const unsubBuild = engine.events.on('car:build-updated', ({ build }) => {
      storage.mirrorLocalBuild(build, engine.getActiveTrack().id);
    });

    const unsubLap = engine.events.on('lap:finished', (payload) => {
      const track = engine.getActiveTrack();
      void storage.recordCompletedLap(payload, track.baseLapRewardCredits);
    });

    return () => {
      active = false;
      unsubConfig();
      unsubBuild();
      unsubLap();
    };
  }, [engine, storage]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    void engine.mountCanvas(canvas);
    return () => {
      engine.dispose();
    };
  }, [engine]);

  const isAdminRoute = pathname === '/admin' || pathname.startsWith('/admin/');

  return (
    <div className="relative w-screen h-[100dvh] overflow-hidden bg-[#0A0C10] text-slate-100">
      <canvas
        ref={canvasRef}
        className="modulus-webgl-canvas absolute inset-0 z-0"
      />
      {isAdminRoute ? (
        <div className="absolute inset-0 z-20 overflow-y-auto bg-[#0A0C10]/95 backdrop-blur-md">
          <AdminPanel engine={engine} storage={storage} />
        </div>
      ) : (
        <AppShell engine={engine} storage={storage} />
      )}
      <AuthModal engine={engine} storage={storage} />
    </div>
  );
}
