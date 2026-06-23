import type { ReactNode } from "react";
import {
  defineWorkbenchComponent,
  type WorkbenchNodeDefinition,
  type WorkbenchRegisteredComponent
} from "../../../lib/workbench/nodes.js";

export function defineWorkbenchBox<Props extends Record<string, unknown>>(
  component: (props: Props) => ReactNode,
  definition: Omit<WorkbenchNodeDefinition, "WebView">
) {
  const WorkbenchBoxComponent = (props: Props) => component(props);
  WorkbenchBoxComponent.displayName = definition.title.replace(/\s+/g, "");
  return defineWorkbenchComponent(
    WorkbenchBoxComponent,
    definition
  ) as WorkbenchRegisteredComponent<Props>;
}
