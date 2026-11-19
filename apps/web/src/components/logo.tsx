import Image from 'next/image';
import mark from '../../public/brand/trustelect-mark.png';

/** TrustElect mark: shield, ballot box and tick. Decorative; the name is always written next to it. */
export function LogoMark({ size = 32 }: { size?: number }) {
  return <Image src={mark} alt="" width={size} height={size} className="shrink-0" />;
}

/** The name as in the logo: "Trust" in deep green, "Elect" in flag green. */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`font-bold tracking-tight ${className}`}>
      <span className="text-brand-strong">Trust</span>
      <span className="text-brand">Elect</span>
    </span>
  );
}
