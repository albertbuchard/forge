import { defineWorkbenchComponent } from "../../../lib/workbench/nodes.js";
export function defineWorkbenchBox(component, definition) {
    const WorkbenchBoxComponent = (props) => component(props);
    WorkbenchBoxComponent.displayName = definition.title.replace(/\s+/g, "");
    return defineWorkbenchComponent(WorkbenchBoxComponent, definition);
}
