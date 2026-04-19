import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect, useId, useRef, useState } from "react";
import { CircleHelp } from "lucide-react";
import { cn } from "../../lib/utils.js";
export function FieldHint({ children, className }) {
    return _jsx("div", { className: cn("text-sm leading-6 text-white/50", className), children: children });
}
export function InfoTooltip({ content, label = "Explain this field", className }) {
    const [open, setOpen] = useState(false);
    const containerRef = useRef(null);
    const tooltipId = useId();
    useEffect(() => {
        if (!open) {
            return;
        }
        const handlePointerDown = (event) => {
            if (!containerRef.current?.contains(event.target)) {
                setOpen(false);
            }
        };
        document.addEventListener("pointerdown", handlePointerDown);
        return () => document.removeEventListener("pointerdown", handlePointerDown);
    }, [open]);
    return (_jsxs("span", { ref: containerRef, className: cn("relative inline-flex items-center", className), onMouseEnter: () => setOpen(true), onMouseLeave: () => setOpen(false), children: [_jsx("button", { type: "button", "aria-label": label, "aria-describedby": open ? tooltipId : undefined, "aria-expanded": open, className: "inline-flex size-5 items-center justify-center rounded-full text-white/42 transition hover:bg-white/[0.06] hover:text-white/78 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[rgba(192,193,255,0.35)]", onFocus: () => setOpen(true), onBlur: () => setOpen(false), onClick: () => setOpen((current) => !current), children: _jsx(CircleHelp, { className: "size-3.5" }) }), _jsx("span", { id: tooltipId, role: "tooltip", className: cn("pointer-events-none absolute right-0 top-[calc(100%+0.55rem)] z-40 w-[min(16rem,calc(100vw-2.5rem))] max-w-[calc(100vw-2.5rem)] rounded-[18px] border border-white/8 bg-[rgba(12,17,30,0.96)] px-3 py-2.5 text-sm leading-6 text-white/74 shadow-[0_18px_48px_rgba(3,8,18,0.42)] transition", open ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"), children: content })] }));
}
