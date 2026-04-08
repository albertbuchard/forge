export function defineWorkbenchComponent(component, workbench) {
    return Object.assign(component, {
        workbench: {
            ...workbench,
            WebView: component
        }
    });
}
export function isWorkbenchRegisteredComponent(value) {
    const candidate = value;
    return Boolean(candidate &&
        typeof value === "function" &&
        candidate.workbench &&
        typeof candidate.workbench.id === "string");
}
