import type { TextareaHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Textarea({ className, ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      {...props}
      className={cn(
        "min-h-28 w-full rounded-[22px] border border-white/8 bg-white/6 px-4 py-3 text-[15px] text-white outline-none placeholder:text-white/35 focus:border-[rgba(192,193,255,0.35)]",
        className
      )}
    />
  );
}
