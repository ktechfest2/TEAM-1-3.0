import Image from 'next/image';
import mark from '../../public/brand/trustelect-mark.png';

/** TrustElect mark: shield, ballot box and tick. Decorative; the name is always written next to it. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return <Image src={mark} alt="" width={size} height={size} className="shrink-0" />;
}

/** The name as in the logo: "Trust" in deep green, "Elect" in a lighter green. */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-bold tracking-tight ${className}`}>
      {/* Two greens as in the logo, both readable on white and grey (WCAG AA) */}
      <span className="text-[#0b3d2a]">Trust</span>
      <span className="text-brand-strong">Elect</span>
    </span>
  );
}
