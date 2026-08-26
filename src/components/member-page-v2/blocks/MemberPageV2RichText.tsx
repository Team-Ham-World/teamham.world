import type { RichTextBlock, RichTextDoc, RichTextBlockNode, RichTextText, RichTextMark } from "@/lib/members/v2/document";

interface MemberPageV2RichTextProps {
  block: RichTextBlock;
}

export function MemberPageV2RichText({ block }: MemberPageV2RichTextProps) {
  return (
    <div className="prose-member">
      {renderRichTextDoc(block.content)}
    </div>
  );
}

function renderRichTextDoc(doc: RichTextDoc): React.ReactNode {
  return doc.content.map((node, index) => renderBlockNode(node, index));
}

function renderBlockNode(node: RichTextBlockNode, key: React.Key): React.ReactNode {
  switch (node.type) {
    case "paragraph":
      return (
        <p key={key} className="mt-4 first:mt-0 leading-relaxed">
          {node.content.map((text, idx) => renderTextNode(text, idx))}
        </p>
      );
    case "heading":
      if (node.attrs.level === 2) {
        return (
          <h2
            key={key}
            className="font-display text-2xl leading-tight mt-12 first:mt-0 sm:text-3xl"
          >
            {node.content.map((text, idx) => renderTextNode(text, idx))}
          </h2>
        );
      }
      return (
        <h3
          key={key}
          className="font-display text-xl leading-tight mt-10 first:mt-0 sm:text-2xl"
        >
          {node.content.map((text, idx) => renderTextNode(text, idx))}
        </h3>
      );
    case "bulletList":
      return (
        <ul key={key} className="mt-4 first:mt-0 list-disc space-y-2 pl-6">
          {node.content.map((item, idx) => (
            <li key={idx}>
              {item.content.map((blockNode, blockIdx) =>
                renderBlockNode(blockNode, blockIdx)
              )}
            </li>
          ))}
        </ul>
      );
    case "orderedList":
      return (
        <ol key={key} className="mt-4 first:mt-0 list-decimal space-y-2 pl-6">
          {node.content.map((item, idx) => (
            <li key={idx}>
              {item.content.map((blockNode, blockIdx) =>
                renderBlockNode(blockNode, blockIdx)
              )}
            </li>
          ))}
        </ol>
      );
    case "blockquote":
      return (
        <blockquote
          key={key}
          className="mt-4 first:mt-0 border-l-4 border-ink pl-6 text-muted italic"
        >
          {node.content.map((blockNode, idx) => renderBlockNode(blockNode, idx))}
        </blockquote>
      );
    default:
      return null;
  }
}

function renderTextNode(text: RichTextText, key: React.Key): React.ReactNode {
  if (!text.marks || text.marks.length === 0) {
    return <span key={key}>{text.text}</span>;
  }

  let content: React.ReactNode = text.text;

  // Apply marks in reverse order so they nest properly
  const sortedMarks = [...text.marks].reverse();
  for (const mark of sortedMarks) {
    content = applyMark(mark, content);
  }

  return <span key={key}>{content}</span>;
}

function applyMark(mark: RichTextMark, content: React.ReactNode): React.ReactNode {
  switch (mark.type) {
    case "bold":
      return <strong className="font-bold text-ink">{content}</strong>;
    case "italic":
      return <em>{content}</em>;
    case "link":
      return (
        <a
          href={mark.attrs.href}
          rel="noopener noreferrer"
          className="inline-flex min-h-11 min-w-11 items-center font-bold text-interactive-blue underline underline-offset-4"
        >
          {content}
        </a>
      );
    default:
      return content;
  }
}
