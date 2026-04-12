import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { Handle, Position } from "@xyflow/react";
import { useState } from "react";
import { InfoTooltip } from "../../../components/ui/info-tooltip.js";
import { cn } from "../../../lib/utils.js";
function describePort(port) {
    return [port.kind, port.modelName, port.itemKind ? `item:${port.itemKind}` : null]
        .filter(Boolean)
        .join(" · ");
}
function PortList({ title, ports, align }) {
    return (_jsxs("div", { className: "grid gap-1.5", children: [_jsxs("div", { className: cn("flex items-center gap-1 text-[10px] uppercase tracking-[0.18em] text-white/34", align === "left" ? "text-left" : "text-right"), children: [_jsx("span", { children: title }), _jsx(InfoTooltip, { content: align === "left"
                            ? "Inputs are values this box expects from upstream nodes."
                            : "Outputs are values this box publishes for downstream nodes.", label: align === "left" ? "Explain box inputs" : "Explain box outputs" })] }), ports.length === 0 ? (_jsx("div", { className: "rounded-full border border-dashed border-white/10 px-3 py-1.5 text-[11px] text-white/28", children: "None" })) : null, ports.map((port) => (_jsxs("div", { className: cn("relative rounded-[16px] bg-white/[0.05] px-3 py-2 text-[11px] text-white/62", align === "left" ? "pl-5 text-left" : "pr-5 text-right"), children: [_jsx(Handle, { type: align === "left" ? "target" : "source", position: align === "left" ? Position.Left : Position.Right, id: port.key, className: "!size-2.5 !border !border-white/80 !bg-[#b8c5ff]", style: {
                            [align]: 6
                        } }), _jsx("div", { children: port.label }), _jsx("div", { className: "mt-1 text-[10px] text-white/38", children: describePort(port) })] }, port.key)))] }));
}
export function createGenericWorkbenchNodeView(definition) {
    return function GenericWorkbenchNodeView(_props) {
        const [schemaOpen, setSchemaOpen] = useState(false);
        return (_jsxs("div", { className: "min-w-[280px] rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(20,28,45,0.98),rgba(11,16,29,0.98))] p-3 shadow-[0_26px_80px_rgba(0,0,0,0.4)]", children: [_jsxs("div", { className: "flex items-start justify-between gap-3", children: [_jsxs("div", { className: "min-w-0", children: [_jsx("div", { className: "truncate text-sm font-semibold text-white", children: definition.title }), _jsx("div", { className: "mt-1 line-clamp-2 text-[12px] leading-5 text-white/48", children: definition.description })] }), _jsx("div", { className: "rounded-full bg-white/[0.06] px-2.5 py-1 text-[10px] uppercase tracking-[0.16em] text-white/56", children: "box" })] }), definition.params.length > 0 ? (_jsxs("div", { className: "mt-3 rounded-[18px] bg-white/[0.04] px-3 py-2 text-[11px] text-white/52", children: [definition.params.length, " param", definition.params.length === 1 ? "" : "s", " configurable in the flow editor"] })) : null, definition.tools.length > 0 ? (_jsxs("div", { className: "mt-2 rounded-[18px] bg-white/[0.04] px-3 py-2 text-[11px] text-white/52", children: [definition.tools.length, " tool", definition.tools.length === 1 ? "" : "s", " available"] })) : null, _jsx("div", { className: "mt-2", children: _jsx("button", { type: "button", className: "rounded-full bg-white/[0.05] px-3 py-1.5 text-[11px] text-white/56 transition hover:bg-white/[0.08] hover:text-white", onClick: () => setSchemaOpen((current) => !current), children: schemaOpen ? "Hide schema" : "Preview schema" }) }), _jsxs("div", { className: "mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-3", children: [_jsx(PortList, { title: "Inputs", ports: definition.inputs, align: "left" }), _jsx(PortList, { title: "Outputs", ports: definition.output, align: "right" })] }), schemaOpen ? (_jsxs("div", { className: "mt-3 rounded-[18px] border border-white/8 bg-black/20 p-3", children: [_jsxs("div", { className: "flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-white/38", children: [_jsx("span", { children: "Box contract" }), _jsx(InfoTooltip, { content: "This preview summarizes what the box consumes, publishes, and what tools it can expose to AI nodes.", label: "Explain box contract preview" })] }), _jsx("pre", { className: "mt-2 overflow-auto whitespace-pre-wrap text-[11px] leading-5 text-white/64", children: JSON.stringify({
                                inputs: definition.inputs.map(({ key, kind, required, description, modelName, itemKind, shape, exampleValue }) => ({
                                    key,
                                    kind,
                                    required: Boolean(required),
                                    description,
                                    modelName,
                                    itemKind,
                                    shape,
                                    exampleValue
                                })),
                                outputs: definition.output.map(({ key, kind, required, description, modelName, itemKind, shape, exampleValue }) => ({
                                    key,
                                    kind,
                                    required: Boolean(required),
                                    description,
                                    modelName,
                                    itemKind,
                                    shape,
                                    exampleValue
                                })),
                                tools: definition.tools.map(({ key, accessMode, argsSchema }) => ({
                                    key,
                                    accessMode,
                                    argsSchema
                                }))
                            }, null, 2) })] })) : null] }));
    };
}
