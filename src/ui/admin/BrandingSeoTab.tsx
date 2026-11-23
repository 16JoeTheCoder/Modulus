import { useState } from 'react';
import { Globe, MessageSquare, Share2 } from 'lucide-react';
import type { IBrandingConfig } from '../../core/types';

interface BrandingSeoTabProps {
  baseline: IBrandingConfig;
  staged: IBrandingConfig;
  onChange: (next: IBrandingConfig) => void;
}

type PreviewPlatform = 'discord' | 'twitter' | 'imessage';

export function BrandingSeoTab({ baseline, staged, onChange }: BrandingSeoTabProps) {
  const [platform, setPlatform] = useState<PreviewPlatform>('discord');

  const fullTitle = `${staged.site_name || 'Modulus'} — ${staged.tagline || 'Build the machine. Master the physics.'}`;
  const cleanDomain = (staged.domain || 'modulus.josefyang.com')
    .replace(/^https?:\/\//, '')
    .replace(/\/+$/, '');

  const isChanged = (field: keyof IBrandingConfig) => staged[field] !== baseline[field];

  return (
    <div className="grid grid-cols-1 xl:grid-cols-12 gap-5">
      {/* Left: Branding Inputs */}
      <div className="xl:col-span-5 bg-[#12161F] border border-[#1E2532] rounded-xl p-4 space-y-4">
        <div>
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
            Edge SEO & Branding (HTMLRewriter)
          </h3>
          <p className="text-[11px] text-slate-400 mt-0.5">
            Injected live at Cloudflare Edge into{' '}
            <code className="text-[#00F0FF]">&lt;title&gt;</code>, OpenGraph, Twitter Card, and
            JSON-LD <code className="text-[#00F0FF]">VideoGame</code> schema.
          </p>
        </div>

        <div className="space-y-3">
          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                Site Name
              </label>
              {isChanged('site_name') && (
                <span className="text-[10px] font-mono text-[#F59E0B]">MODIFIED</span>
              )}
            </div>
            <input
              type="text"
              maxLength={60}
              value={staged.site_name}
              onChange={(e) => onChange({ ...staged, site_name: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-[#0A0C10] border border-[#1E2532] focus:border-[#00F0FF] focus:outline-none text-sm text-slate-100"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                Canonical Domain
              </label>
              {isChanged('domain') && (
                <span className="text-[10px] font-mono text-[#F59E0B]">MODIFIED</span>
              )}
            </div>
            <input
              type="text"
              maxLength={120}
              value={staged.domain}
              onChange={(e) => onChange({ ...staged, domain: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-[#0A0C10] border border-[#1E2532] focus:border-[#00F0FF] focus:outline-none text-sm font-mono text-slate-100"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                Tagline
              </label>
              <span className="text-[10px] font-mono text-slate-500">
                {staged.tagline.length}/140
              </span>
            </div>
            <input
              type="text"
              maxLength={140}
              value={staged.tagline}
              onChange={(e) => onChange({ ...staged, tagline: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-[#0A0C10] border border-[#1E2532] focus:border-[#00F0FF] focus:outline-none text-sm text-slate-100"
            />
          </div>

          <div>
            <div className="flex justify-between items-center mb-1">
              <label className="text-[11px] font-semibold uppercase tracking-wider text-slate-300">
                Meta Description
              </label>
              <span className="text-[10px] font-mono text-slate-500">
                {staged.meta_description.length}/320
              </span>
            </div>
            <textarea
              rows={4}
              maxLength={320}
              value={staged.meta_description}
              onChange={(e) => onChange({ ...staged, meta_description: e.target.value })}
              className="w-full px-3 py-2 rounded-lg bg-[#0A0C10] border border-[#1E2532] focus:border-[#00F0FF] focus:outline-none text-sm text-slate-100 resize-none"
            />
          </div>
        </div>
      </div>

      {/* Right: Instant Social Card Preview */}
      <div className="xl:col-span-7 bg-[#12161F] border border-[#1E2532] rounded-xl p-4 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-200">
              Instant Social Card Preview
            </h3>
            <p className="text-[11px] text-slate-400">
              Live OpenGraph render using <code className="text-slate-300">/assets/og-banner.png</code>
            </p>
          </div>
          <div className="flex items-center gap-1 bg-[#0A0C10] p-1 rounded-lg border border-[#1E2532]">
            {(
              [
                { id: 'discord', label: 'Discord', icon: MessageSquare },
                { id: 'twitter', label: 'X / Twitter', icon: Share2 },
                { id: 'imessage', label: 'iMessage', icon: Globe },
              ] as const
            ).map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setPlatform(tab.id)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-colors ${
                    platform === tab.id
                      ? 'bg-[#00F0FF]/15 text-[#00F0FF] border border-[#00F0FF]/35'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-xl bg-[#0A0C10] border border-[#1E2532] p-5 flex items-center justify-center min-h-[340px]">
          {platform === 'discord' && (
            <div className="w-full max-w-md rounded-md bg-[#2B2D31] border-l-4 border-[#00F0FF] p-3.5 space-y-2 shadow-lg">
              <div className="text-[11px] font-semibold text-slate-300">
                {staged.site_name || 'Modulus'}
              </div>
              <div className="text-sm font-bold text-[#00A8FC] hover:underline cursor-pointer">
                {fullTitle}
              </div>
              <p className="text-xs text-slate-300 leading-relaxed">{staged.meta_description}</p>
              <div className="rounded overflow-hidden border border-black/30 bg-[#0A0C10] aspect-[1200/630]">
                <img
                  src="/assets/og-banner.png"
                  alt="Modulus OG Banner"
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          )}

          {platform === 'twitter' && (
            <div className="w-full max-w-md rounded-2xl overflow-hidden border border-slate-700 bg-black shadow-lg">
              <div className="aspect-[1200/630] bg-[#0A0C10] relative">
                <img
                  src="/assets/og-banner.png"
                  alt="Modulus OG Banner"
                  className="w-full h-full object-cover"
                />
                <span className="absolute bottom-2.5 left-2.5 px-2 py-0.5 rounded bg-black/75 text-[11px] font-medium text-white">
                  {fullTitle}
                </span>
              </div>
              <div className="px-3.5 py-2.5 space-y-0.5 bg-[#0F1419]">
                <div className="text-[11px] text-slate-400">From {cleanDomain}</div>
                <div className="text-xs text-slate-300 line-clamp-2">
                  {staged.meta_description}
                </div>
              </div>
            </div>
          )}

          {platform === 'imessage' && (
            <div className="w-full max-w-xs rounded-2xl overflow-hidden bg-[#1C1C1E] border border-slate-700/80 shadow-xl">
              <div className="aspect-[1200/630] bg-[#0A0C10]">
                <img
                  src="/assets/og-banner.png"
                  alt="Modulus OG Banner"
                  className="w-full h-full object-cover"
                />
              </div>
              <div className="p-3 bg-[#2C2C2E] space-y-0.5">
                <div className="text-xs font-semibold text-white leading-snug">{fullTitle}</div>
                <div className="text-[11px] text-slate-400">{cleanDomain}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
