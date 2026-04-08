import { getWorkbenchNodeCatalog, getWorkbenchNodeDefinition, listWorkbenchNodeDefinitions } from "./registry.js";
export function listWorkbenchBoxDefinitions() {
    return listWorkbenchNodeDefinitions();
}
export function getWorkbenchBoxDefinition(boxId) {
    return getWorkbenchNodeDefinition(boxId);
}
export function getWorkbenchBoxDefinitionForSurfaceWidget(surfaceId, widgetId) {
    return getWorkbenchBoxDefinition(`surface:${surfaceId}:${widgetId}`);
}
export function getWorkbenchBoxDefinitionForRouteMain(surfaceId) {
    return getWorkbenchBoxDefinition(`surface:${surfaceId}:main`);
}
export function listWorkbenchBoxCatalogEntries() {
    return getWorkbenchNodeCatalog();
}
