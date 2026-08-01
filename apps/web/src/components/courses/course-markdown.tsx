import ReactMarkdown, { type Components } from "react-markdown";
import rehypeKatex from "rehype-katex";
import remarkMath from "remark-math";
import { cn } from "@/lib/utils";

export function normalizeCourseMarkdown(markdown: string) {
  return markdown
    .replace(
      /\\\[([\s\S]*?)\\\]/gu,
      (_match, content: string) => `\n\n$$\n${content.trim()}\n$$\n\n`
    )
    .replace(
      /\\\(([\s\S]*?)\\\)/gu,
      (_match, content: string) => `$${content.trim()}$`
    );
}

type CourseMarkdownProps = {
  markdown: string;
  className?: string;
  renderMode?: "course-content" | "generated-feedback";
  offsetHeadings?: boolean;
};

const generatedFeedbackComponents: Components = {
  img: () => null,
  a: ({ node: _node, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer" />
  )
};

const offsetHeadingComponents: Components = {
  h1: ({ node: _node, ...props }) => <h2 {...props} />,
  h2: ({ node: _node, ...props }) => <h3 {...props} />,
  h3: ({ node: _node, ...props }) => <h4 {...props} />,
  h4: ({ node: _node, ...props }) => <h5 {...props} />
};

export function CourseMarkdown({
  markdown,
  className,
  renderMode = "course-content",
  offsetHeadings = false
}: CourseMarkdownProps) {
  return (
    <div className={cn("course-markdown", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkMath]}
        rehypePlugins={[rehypeKatex]}
        components={
          renderMode === "generated-feedback"
            ? generatedFeedbackComponents
            : offsetHeadings
              ? offsetHeadingComponents
              : undefined
        }
      >
        {normalizeCourseMarkdown(markdown)}
      </ReactMarkdown>
    </div>
  );
}

export function CourseFeedbackMarkdown(
  props: Omit<CourseMarkdownProps, "renderMode">
) {
  return <CourseMarkdown {...props} renderMode="generated-feedback" />;
}
