import type { ComponentType, ReactNode } from "react";
import { CircleAlert, ExternalLink, Link2 } from "lucide-react";
import { CourseMarkdown } from "@/components/courses/course-markdown";
import type {
  CourseActivity,
  CourseContentBlock,
  CourseResource
} from "@/lib/course-types";
import { cn } from "@/lib/utils";

type ExtensionBlock = Extract<CourseContentBlock, { type: "extension" }>;
type ExtensionActivity = Extract<CourseActivity, { type: "extension" }>;
type ExtensionActivityRendererProps = {
  activity: ExtensionActivity;
  response: string;
  onResponseChange: (response: string) => void;
  disabled: boolean;
};
type CourseLessonLayoutProps = {
  layoutId: string;
  preset: string;
  children: ReactNode;
};

const blockRenderers = new Map<
  string,
  ComponentType<{ block: ExtensionBlock }>
>();
const activityRenderers = new Map<
  string,
  ComponentType<ExtensionActivityRendererProps>
>();
const layoutRenderers = new Map<
  string,
  ComponentType<CourseLessonLayoutProps>
>();

function rendererKey(namespace: string, renderer: string, version: string) {
  return [namespace, renderer, version].join(":");
}

/** Register code that is already trusted and shipped with this Forge build. */
export function registerCourseBlockRenderer(input: {
  namespace: string;
  renderer: string;
  version: string;
  component: ComponentType<{ block: ExtensionBlock }>;
}) {
  blockRenderers.set(
    rendererKey(input.namespace, input.renderer, input.version),
    input.component
  );
}

/** Register code that is already trusted and shipped with this Forge build. */
export function registerCourseActivityRenderer(input: {
  namespace: string;
  renderer: string;
  version: string;
  component: ComponentType<ExtensionActivityRendererProps>;
}) {
  activityRenderers.set(
    rendererKey(input.namespace, input.renderer, input.version),
    input.component
  );
}

/** Register a trusted lesson layout shipped with this Forge build. */
export function registerCourseLayoutRenderer(input: {
  id: string;
  component: ComponentType<CourseLessonLayoutProps>;
}) {
  layoutRenderers.set(input.id, input.component);
}

export function CourseLessonLayoutView({
  layoutId,
  preset,
  children
}: CourseLessonLayoutProps) {
  const Renderer = layoutRenderers.get(layoutId) ?? layoutRenderers.get(preset);
  if (Renderer) {
    return (
      <Renderer layoutId={layoutId} preset={preset}>
        {children}
      </Renderer>
    );
  }
  return (
    <div
      className="course-layout"
      data-course-layout={layoutId}
      data-course-preset={preset}
    >
      {children}
    </div>
  );
}

export function CourseContentBlockView({
  block,
  index,
  resources = []
}: {
  block: CourseContentBlock;
  index: number;
  resources?: CourseResource[];
}) {
  if (block.type === "math") {
    return (
      <figure className="course-math-block">
        <CourseMarkdown markdown={"$$" + block.latex + "$$"} />
        {block.label ? <figcaption>{block.label}</figcaption> : null}
      </figure>
    );
  }
  if (block.type === "callout") {
    return (
      <section className={cn("course-callout", "is-" + block.tone)}>
        <div className="course-kicker">{block.title}</div>
        <CourseMarkdown markdown={block.markdown} className="mt-2" />
      </section>
    );
  }
  if (block.type === "markdown") {
    return <CourseMarkdown markdown={block.markdown} />;
  }
  if (block.type === "divider") {
    return (
      <div className="course-content-divider" role="separator">
        {block.label ? <span>{block.label}</span> : null}
      </div>
    );
  }
  if (block.type === "resource") {
    const resource = resources.find((entry) => entry.id === block.resourceId);
    if (resource) {
      return (
        <a
          className="course-extension-fallback"
          href={resource.url}
          target="_blank"
          rel="noreferrer"
        >
          <Link2 className="size-4" aria-hidden="true" />
          <div>
            <strong>{resource.label}</strong>
            <p>{resource.description}</p>
          </div>
          <ExternalLink className="size-3.5" aria-hidden="true" />
        </a>
      );
    }
    return (
      <div className="course-extension-fallback">
        <Link2 className="size-4" aria-hidden="true" />
        <div>
          <strong>Course resource</strong>
          <p>
            Open resource <code>{block.resourceId}</code> from the course
            overview.
          </p>
        </div>
      </div>
    );
  }
  const Renderer = blockRenderers.get(
    rendererKey(block.namespace, block.renderer, block.version)
  );
  if (Renderer) return <Renderer block={block} />;
  return (
    <div className="course-extension-fallback" data-block-index={index}>
      <CircleAlert className="size-4" aria-hidden="true" />
      <div>
        <strong>Optional course component unavailable</strong>
        <p>
          Forge can continue safely, but the trusted renderer{" "}
          <code>
            {block.namespace}:{block.renderer}@{block.version}
          </code>{" "}
          is not installed.
        </p>
      </div>
    </div>
  );
}

export function CourseExtensionActivityView({
  activity,
  response,
  onResponseChange,
  disabled
}: {
  activity: ExtensionActivity;
  response: string;
  onResponseChange: (response: string) => void;
  disabled: boolean;
}) {
  const Renderer = activityRenderers.get(
    rendererKey(activity.namespace, activity.renderer, activity.version)
  );
  if (Renderer) {
    return (
      <Renderer
        activity={activity}
        response={response}
        onResponseChange={onResponseChange}
        disabled={disabled}
      />
    );
  }
  return (
    <div className="course-extension-fallback mt-5">
      <CircleAlert className="size-4" aria-hidden="true" />
      <div>
        <strong>Using the portable activity fallback</strong>
        <p>
          The enhanced renderer{" "}
          <code>
            {activity.namespace}:{activity.renderer}@{activity.version}
          </code>{" "}
          is not installed. No package-supplied code was executed.
        </p>
        {activity.responseMode === "none" ? (
          <p className="mt-3">
            Submit when you have completed the instructions above.
          </p>
        ) : (
          <label className="course-extension-response">
            <span>
              {activity.responseMode === "structured"
                ? "Your structured response"
                : "Your response"}
            </span>
            <textarea
              value={response}
              onChange={(event) => onResponseChange(event.target.value)}
              disabled={disabled}
              placeholder="Record your result and reasoning…"
            />
          </label>
        )}
      </div>
    </div>
  );
}
