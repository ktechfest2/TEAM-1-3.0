import { encode } from 'uqr';

/** Renders a QR code as SVG from the encoded module matrix (no HTML injection). */
export function QrCode({ value, label, size = 208 }: { value: string; label: string; size?: number }) {
  const { data } = encode(value, { border: 2 });
  const n = data.length;
  let path = '';
  data.forEach((row, y) =>
    row.forEach((dark, x) => {
      if (dark) path += `M${x} ${y}h1v1h-1z`;
    }),
  );
  return (
    <svg
      role="img"
      aria-label={label}
      width={size}
      height={size}
      viewBox={`0 0 ${n} ${n}`}
      shapeRendering="crispEdges"
      className="rounded-lg border border-divider bg-white"
    >
      <rect width={n} height={n} fill="#ffffff" />
      <path d={path} fill="#000000" />
    </svg>
  );
}
