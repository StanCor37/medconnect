import Image from "next/image";

/**
 * Brand lockup for app chrome. Replaces the plain
 * <span className="font-heading text-lg font-semibold">MedConnect</span>
 * in the three role layouts.
 */
export function BrandMark({ size = "default" }: { size?: "default" | "lg" }) {
  const mark = size === "lg" ? 26 : 22;
  return (
    <div className="flex items-center gap-2.5">
      <Image src="/brand/mark.svg" width={mark} height={mark} alt="" priority />
      <span
        className={
          size === "lg"
            ? "font-heading text-xl font-semibold tracking-[-0.028em] text-foreground"
            : "font-heading text-lg font-semibold text-foreground"
        }
      >
        MedConnect
      </span>
    </div>
  );
}
