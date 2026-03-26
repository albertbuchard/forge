import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input({
  className,
  size: _size,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  size?: "md" | "lg";
}) {
  return (
    <input
      {...props}
      className={cn(
        "interactive-tap w-full rounded-[22px] border border-white/8 bg-white/6 px-4 py-3 text-[15px] text-white outline-none ring-0 placeholder:text-white/35 focus:border-[rgba(192,193,255,0.35)]",
        className
      )}
    />
  );
}
