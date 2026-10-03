import Image from "next/image";
import { cn } from "@/lib/utils";

export type PromptstackLogoVariant = "color" | "white";

const SOURCES: Record<PromptstackLogoVariant, { src: string; preferSvg?: boolean }> = {
  /** Color wordmark for light backgrounds (login, light headers). */
  color: { src: "/brand/promptstack-logo.png" },
  /** White wordmark for dark surfaces (sidebar). */
  white: { src: "/brand/promptstack-logo-white.png" },
};

export function PromptstackLogo({
  variant = "color",
  className,
  priority = false,
  alt = "Promptstack Technologies",
}: {
  variant?: PromptstackLogoVariant;
  className?: string;
  priority?: boolean;
  alt?: string;
}) {
  const { src } = SOURCES[variant];
  return (
    <Image
      src={src}
      alt={alt}
      width={1024}
      height={225}
      priority={priority}
      className={cn("h-auto w-full object-contain object-left", className)}
    />
  );
}

/** Compact mark for tight spaces (icon only when SVG available). */
export function PromptstackMark({
  className,
  alt = "Promptstack",
}: {
  className?: string;
  alt?: string;
}) {
  return (
    // eslint-disable-next-line @next/next/no-img-element -- small static brand asset
    <img
      src="/brand/promptstack-icon.svg"
      alt={alt}
      className={cn("h-8 w-8 object-contain", className)}
    />
  );
}
