import { useMemo } from 'react';
import type { ITrackSplineSchema } from '../../core/types';
import {
  buildTrackPreviewData,
  type ITrackPreviewData,
} from '../../plugins/track-generator/trackPreview';

const previewCache = new Map<string, ITrackPreviewData>();

export function getCachedTrackPreview(track: ITrackSplineSchema): ITrackPreviewData {
  const key = `${track.id}:${track.trackVersion ?? 'v1.0.0'}:${track.controlPoints.length}`;
  const hit = previewCache.get(key);
  if (hit) return hit;
  const built = buildTrackPreviewData(track, 160);
  previewCache.set(key, built);
  return built;
}

const SECTOR_COLORS = ['#22D3EE', '#F59E0B', '#34D399'];

interface TrackPreviewSvgProps {
  track: ITrackSplineSchema;
  compact?: boolean;
  showElevation?: boolean;
  showLegend?: boolean;
  className?: string;
}

/**
 * Pure SVG Top-Down Route Map & Elevation Profile driven by `buildTrackPreviewData()`
 * (same TrackSpline as render + collision meshes, zero Three.js overhead).
 */
export function TrackPreviewSvg({
  track,
  compact = false,
  showElevation = true,
  showLegend = false,
  className = '',
}: TrackPreviewSvgProps) {
  const preview = useMemo(() => getCachedTrackPreview(track), [track]);

  const {
    sectorPaths,
    passingPaths,
    driftPaths,
    startX,
    startY,
    arrowPts,
    elevAreaPath,
    elevLinePath,
  } = useMemo(() => {
    const pad = compact ? 10 : 16;
    const size = 160;
    const inner = size - pad * 2;
    const toSvg = (x: number, y: number) => ({
      sx: pad + x * inner,
      sy: pad + y * inner,
    });

    const pts = preview.outline;
    const n = pts.length;

    const buildSegmentedPaths = (
      predicate: (i: number) => number | boolean
    ): Map<number, string> => {
      const grouped = new Map<number, string[]>();
      for (let i = 0; i < n; i++) {
        const res = predicate(i);
        if (res === false) continue;
        const key = typeof res === 'number' ? res : 1;
        const a = toSvg(pts[i].x, pts[i].y);
        const b = toSvg(pts[(i + 1) % n].x, pts[(i + 1) % n].y);
        let list = grouped.get(key);
        if (!list) {
          list = [];
          grouped.set(key, list);
        }
        list.push(`M ${a.sx.toFixed(1)} ${a.sy.toFixed(1)} L ${b.sx.toFixed(1)} ${b.sy.toFixed(1)}`);
      }
      const out = new Map<number, string>();
      for (const [k, segs] of grouped.entries()) {
        out.set(k, segs.join(' '));
      }
      return out;
    };

    const sPaths = buildSegmentedPaths((i) => pts[i].sectorIndex % SECTOR_COLORS.length);
    const pPaths = buildSegmentedPaths((i) => pts[i].inPassingZone);
    const dPaths = buildSegmentedPaths((i) => pts[i].inDriftZone);

    const sp = toSvg(preview.startPoint.x, preview.startPoint.y);
    const hx = preview.startHeading2D.x;
    const hy = preview.startHeading2D.y;
    const perpX = -hy;
    const perpY = hx;
    const tipX = sp.sx + hx * 9;
    const tipY = sp.sy + hy * 9;
    const baseL = `${(sp.sx - hx * 3 + perpX * 4).toFixed(1)},${(sp.sy - hy * 3 + perpY * 4).toFixed(1)}`;
    const baseR = `${(sp.sx - hx * 3 - perpX * 4).toFixed(1)},${(sp.sy - hy * 3 - perpY * 4).toFixed(1)}`;

    // Elevation sparkline (viewBox 0 0 220 38)
    const eW = 220;
    const eH = 34;
    const ePad = 3;
    const maxElev = Math.max(1, preview.elevationRangeM);
    const elevCoords = preview.elevationProfile.map((ep, idx) => {
      const ex = (idx / Math.max(1, preview.elevationProfile.length - 1)) * eW;
      const ey = eH - ePad - (ep.elevationAboveMinM / maxElev) * (eH - ePad * 2 - 4);
      return `${ex.toFixed(1)},${ey.toFixed(1)}`;
    });
    const eLine = elevCoords.length > 0 ? `M ${elevCoords.join(' L ')}` : '';
    const eArea = eLine ? `${eLine} L ${eW},${eH} L 0,${eH} Z` : '';

    return {
      sectorPaths: sPaths,
      passingPaths: pPaths.get(1) ?? '',
      driftPaths: dPaths.get(1) ?? '',
      startX: sp.sx,
      startY: sp.sy,
      arrowPts: `${tipX.toFixed(1)},${tipY.toFixed(1)} ${baseL} ${baseR}`,
      elevAreaPath: eArea,
      elevLinePath: eLine,
    };
  }, [preview, compact]);

  const lengthKm = (preview.totalLengthM / 1000).toFixed(2);
  const elevSpan = preview.elevationRangeM.toFixed(1);

  return (
    <div className={`flex flex-col gap-1.5 ${className}`}>
      <div className="relative overflow-hidden rounded-lg border border-slate-800/90 bg-[#070A10]">
        <svg viewBox="0 0 160 160" className={compact ? 'h-20 w-20' : 'h-36 w-full'}>
          {/* Subtle telemetry grid */}
          {!compact && (
            <g stroke="#111A2B" strokeWidth="0.6">
              <line x1="40" y1="0" x2="40" y2="160" />
              <line x1="80" y1="0" x2="80" y2="160" />
              <line x1="120" y1="0" x2="120" y2="160" />
              <line x1="0" y1="40" x2="160" y2="40" />
              <line x1="0" y1="80" x2="160" y2="80" />
              <line x1="0" y1="120" x2="160" y2="120" />
            </g>
          )}

          {/* Passing zone outer highlight */}
          {passingPaths && (
            <path
              d={passingPaths}
              fill="none"
              stroke="rgba(56, 189, 248, 0.34)"
              strokeWidth={compact ? 6.5 : 8}
              strokeLinecap="round"
            />
          )}

          {/* Drift zone magenta glow */}
          {driftPaths && (
            <path
              d={driftPaths}
              fill="none"
              stroke="rgba(217, 70, 239, 0.55)"
              strokeWidth={compact ? 6.5 : 8.5}
              strokeLinecap="round"
            />
          )}

          {/* Sector-colored route outline */}
          {Array.from(sectorPaths.entries()).map(([secIdx, d]) => (
            <path
              key={secIdx}
              d={d}
              fill="none"
              stroke={SECTOR_COLORS[secIdx] ?? '#22D3EE'}
              strokeWidth={compact ? 3.2 : 3.6}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}

          {/* Start/Finish marker & heading arrow */}
          <circle cx={startX} cy={startY} r={compact ? 3 : 3.5} fill="#FFFFFF" />
          <polygon points={arrowPts} fill="#FFFFFF" />
        </svg>

        {!compact && (
          <div className="pointer-events-none absolute right-2 bottom-1.5 flex items-center gap-2 rounded bg-[#0A0D14]/85 px-1.5 py-0.5 font-mono text-[9px] text-slate-300">
            <span>{lengthKm} km</span>
            <span className="text-slate-600">·</span>
            <span>Δ{elevSpan}m</span>
            <span className="text-slate-600">·</span>
            <span>
              {preview.widthMinM.toFixed(0)}–{preview.widthMaxM.toFixed(0)}m
            </span>
          </div>
        )}
      </div>

      {/* Elevation Profile Sparkline */}
      {showElevation && !compact && (
        <div className="rounded-lg border border-slate-800/80 bg-[#070A10] px-2 py-1.5">
          <div className="mb-1 flex items-center justify-between font-mono text-[9px] text-slate-400">
            <span>ELEVATION PROFILE</span>
            <span className="text-cyan-300">
              {preview.elevationMinM.toFixed(0)}m – {preview.elevationMaxM.toFixed(0)}m (Δ{elevSpan}m)
            </span>
          </div>
          <svg viewBox="0 0 220 34" className="h-8 w-full" preserveAspectRatio="none">
            <path d={elevAreaPath} fill="rgba(34, 211, 238, 0.16)" />
            <path d={elevLinePath} fill="none" stroke="#22D3EE" strokeWidth="1.6" />
          </svg>
        </div>
      )}

      {/* Sector & Zone Legend */}
      {showLegend && !compact && (
        <div className="flex flex-wrap items-center gap-2 font-mono text-[9px] text-slate-400">
          {preview.sectors.map((s, idx) => (
            <span key={s.index} className="inline-flex items-center gap-1">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: SECTOR_COLORS[idx % SECTOR_COLORS.length] }}
              />
              <span>
                S{idx + 1} {s.name}
              </span>
            </span>
          ))}
          {driftPaths && (
            <span className="inline-flex items-center gap-1 text-fuchsia-300">
              <span className="h-2 w-2 rounded-full bg-fuchsia-400" />
              <span>Drift Zone</span>
            </span>
          )}
        </div>
      )}
    </div>
  );
}
