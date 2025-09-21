"use client";

type Props = {
  value: string;
  onChange: (v: string) => void;
};

export default function SearchBar({ value, onChange }: Props) {
  return (
    <div className="mb-4">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Search menu…"
        className="w-full rounded-xl border px-4 py-2"
      />
      <div className="mt-2 text-sm text-gray-500">
        Tip: try “chips”, “mojito”, “steak”…
      </div>
    </div>
  );
}
