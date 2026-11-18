/** TrustElect mark: a ballot tick on Nigerian flag green. Decorative. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true" focusable="false">
      <rect x="1" y="1" width="30" height="30" rx="9" fill="var(--brand)" />
      <rect x="11.5" y="1" width="9" height="30" fill="var(--brand-ink)" opacity="0.18" />
      <path
        d="m9 16.5 4.5 4.5 9.5-10"
        fill="none"
        stroke="var(--brand-ink)"
        strokeWidth="3.2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
