import { useRef, useState } from "react";
import type { PaletteEntry } from "./model";
import { searchPalette } from "./paletteSearch";

type Frame = {
  id: number;
  title: string;
  entries: PaletteEntry[];
  query: string;
  selected: string;
  parent?: PaletteEntry;
  loading?: boolean;
  error?: boolean;
};

export function usePaletteNavigation(roots: PaletteEntry[], title: string) {
  const sequence = useRef(0);
  const [frames, setFrames] = useState<Frame[]>([
    { id: 0, title, entries: roots, query: "", selected: "" },
  ]);
  const frame = frames[frames.length - 1];
  const entries = searchPalette(frame.entries, frame.query);
  const selected = entries.find((entry) => entry.id === frame.selected) ?? entries[0];

  function update(id: number, change: Partial<Frame>) {
    setFrames((current) => current.map((item) => item.id === id ? { ...item, ...change } : item));
  }

  async function load(target: Frame) {
    update(target.id, { loading: true, error: false });
    try {
      const children = await target.parent!.children!();
      update(target.id, { entries: children, loading: false });
    } catch {
      update(target.id, { loading: false, error: true });
    }
  }

  function enter(entry: PaletteEntry) {
    if (!entry.children) return;
    const next: Frame = {
      id: ++sequence.current, title: entry.label, entries: [], query: "", selected: "",
      parent: entry, loading: true,
    };
    setFrames((current) => [...current.slice(0, -1), { ...frame, selected: entry.id }, next]);
    void load(next);
  }

  return {
    frame, entries, selected,
    canBack: frames.length > 1,
    path: frames.map((item) => item.title).join(" / "),
    enter,
    back: () => setFrames((current) => current.length > 1 ? current.slice(0, -1) : current),
    retry: () => void load(frame),
    search: (query: string) => update(frame.id, { query, selected: "" }),
    select: (selected: string) => update(frame.id, { selected }),
  };
}
