import { useRef, useState } from 'react';
import { Plus, X } from 'lucide-react';
import { CHASSIS_CATALOG, createFactoryBuild } from '../../content';
import type { StorageSync } from '../../core/StorageSync';
import type { IChassisSchema, IVehicleBuildConfig } from '../../core/types';
import { CarPreview } from './CarPreview';

interface NewCarPickerProps {
  storage: StorageSync;
  priceMultiplier: number;
  onCreate: (build: IVehicleBuildConfig) => void;
  className: string;
  compact?: boolean;
}

export function NewCarPicker({ storage, priceMultiplier, onCreate, className, compact }: NewCarPickerProps) {
  const dialog = useRef<HTMLDialogElement>(null);
  const purchasePending = useRef(false);
  const [buying, setBuying] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [selected, setSelected] = useState<IChassisSchema>(CHASSIS_CATALOG[0]);
  const owned = storage.isPartOwned(selected.id);

  const selectChassis = async (chassis: IChassisSchema) => {
    if (purchasePending.current) return;
    setError(null);
    if (!storage.isPartOwned(chassis.id)) {
      purchasePending.current = true;
      setBuying(chassis.id);
      try {
        const result = await storage.purchaseItem(chassis.id);
        if (!result.ok) {
          setError(result.error ?? 'Unable to buy this chassis.');
          return;
        }
      } finally {
        purchasePending.current = false;
        setBuying(null);
      }
    }

    onCreate(createFactoryBuild(chassis, `build_${crypto.randomUUID()}`));
    dialog.current?.close();
  };

  return (
    <>
      <button
        type="button"
        aria-label={compact ? 'New build' : 'New car'}
        aria-haspopup="dialog"
        title={compact ? 'New build' : 'New car'}
        className={className}
        onClick={() => {
          setError(null);
          setPreviewOpen(true);
          dialog.current?.showModal();
        }}
      >
        <Plus aria-hidden="true" className="h-3.5 w-3.5" />
        {!compact && <span>New</span>}
      </button>

      <dialog
        ref={dialog}
        aria-label="Choose a chassis"
        onClose={() => setPreviewOpen(false)}
        onCancel={(event) => {
          if (purchasePending.current) event.preventDefault();
        }}
        className="pointer-events-auto fixed inset-0 m-auto max-h-[90dvh] w-[calc(100%-2rem)] max-w-3xl overflow-y-auto rounded-2xl border border-slate-700 bg-[#0A0D14] p-4 text-slate-100 backdrop:bg-black/70 sm:p-6"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h2 className="text-xl font-semibold">Choose a chassis</h2>
            <p className="mt-1 text-sm text-slate-400">Start a new car with its factory setup.</p>
          </div>
          <button
            type="button"
            aria-label="Close chassis picker"
            disabled={buying !== null}
            onClick={() => dialog.current?.close()}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="grid gap-4 md:grid-cols-[minmax(0,1fr)_14rem]">
          <div className="min-w-0">
            {previewOpen && <CarPreview chassis={selected} />}
            <div className="mt-3 flex flex-wrap items-end justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold">{selected.name}</h3>
                <p className="mt-1 max-w-sm text-sm text-slate-300">{selected.subtitle}</p>
              </div>
              <button type="button" disabled={buying !== null} onClick={() => void selectChassis(selected)}
                className="rounded-lg bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 hover:bg-cyan-300 disabled:opacity-60">
                {buying ? 'Buying…' : owned ? 'Create car' : `Buy · ${Math.round(selected.price * priceMultiplier).toLocaleString()} CR`}
              </button>
            </div>
            {error && <p role="alert" className="mt-3 text-sm text-rose-300">{error}</p>}
          </div>
          <div className="grid max-h-38 content-start gap-1 overflow-y-auto md:max-h-[22rem]" aria-label="Chassis models">
            {CHASSIS_CATALOG.map((chassis) => (
              <button
                key={chassis.id}
                type="button"
                disabled={buying !== null}
                aria-pressed={chassis.id === selected.id}
                onClick={() => { setSelected(chassis); setError(null); }}
                className="flex items-center gap-2 rounded-lg border border-slate-800 px-3 py-2 text-left text-sm font-medium hover:border-slate-500 aria-pressed:border-cyan-400/60 aria-pressed:bg-cyan-400/10"
              >
                <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: chassis.primaryColorHex }} />
                {chassis.name}
              </button>
            ))}
          </div>
        </div>
      </dialog>
    </>
  );
}
