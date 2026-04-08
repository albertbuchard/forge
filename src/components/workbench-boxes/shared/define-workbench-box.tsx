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
  return defineWorkbenchComponent(component, definition) as WorkbenchRegisteredComponent<Props>;
}
