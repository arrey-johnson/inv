import type { ReactNode } from "react";

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4 py-12">
      {/* Soft brand glow echoing the letterhead diamonds */}
      <div
        aria-hidden
        className="pointer-events-none absolute -right-24 -top-24 size-96 rotate-45 rounded-3xl border-[10px] border-brand/80 opacity-20"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -left-20 size-80 rotate-45 rounded-3xl border-[10px] border-brand-soft opacity-40"
      />
      <div className="relative w-full max-w-md">{children}</div>
    </div>
  );
}
