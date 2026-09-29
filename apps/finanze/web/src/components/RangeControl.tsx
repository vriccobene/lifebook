import { useMemo, useState, type ReactNode } from "react";
import { useSnapshots } from "../api/queries";
import { todayIso } from "../lib/dates";
import { RANGE_LABELS, resolveRange, type DateRange, type RangeKey } from "../lib/range";

/** Time range selector (3 months, 1 year, everything, custom) shared by all the history views. */
export function useRangeControl(initial: RangeKey = "1y"): {
  range: DateRange;
  control: ReactNode;
} {
  const today = todayIso();
  const snapshots = useSnapshots();
  const [key, setKey] = useState<RangeKey>(initial);
  const [custom, setCustom] = useState({ from: `${today.slice(0, 4)}-01-01`, to: today });
  const earliest = useMemo(
    () =>
      snapshots.data?.length
        ? snapshots.data.reduce((min, s) => (s.date < min ? s.date : min), snapshots.data[0]!.date)
        : null,
    [snapshots.data],
  );
  const range = resolveRange(key, today, earliest, custom);
  const control = (
    <div className="range" role="group" aria-label="Intervallo temporale">
      {(Object.keys(RANGE_LABELS) as RangeKey[]).map((k) => (
        <button key={k} aria-pressed={key === k} onClick={() => setKey(k)}>
          {RANGE_LABELS[k]}
        </button>
      ))}
      {key === "custom" && (
        <>
          <input
            type="date"
            aria-label="Dal"
            value={custom.from}
            onChange={(e) => setCustom({ ...custom, from: e.target.value })}
          />
          <input
            type="date"
            aria-label="Al"
            value={custom.to}
            onChange={(e) => setCustom({ ...custom, to: e.target.value })}
          />
        </>
      )}
    </div>
  );
  return { range, control };
}
