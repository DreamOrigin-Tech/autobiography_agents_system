"use client";

type Block =
  | { type: "heading"; level: 1 | 2 | 3; text: string }
  | { type: "quote"; text: string }
  | { type: "list"; items: string[] }
  | { type: "paragraph"; text: string };

interface MarkdownContentProps {
  content: string;
  streaming?: boolean;
  stripLeadingHeading?: boolean;
}

export function MarkdownContent({ content, streaming = false, stripLeadingHeading = false }: MarkdownContentProps) {
  const parsedBlocks = parseBlocks(content);
  const blocks = stripLeadingHeading && parsedBlocks[0]?.type === "heading"
    ? parsedBlocks.slice(1)
    : parsedBlocks;

  return (
    <article className="prose-chapter mx-auto max-w-prose">
      {blocks.length > 0 ? blocks.map((block, index) => renderBlock(block, index)) : <p />}
      {streaming && <span className="ml-0.5 inline-block h-5 w-1.5 animate-pulse rounded-full bg-[#0f766e] align-middle" />}
    </article>
  );
}

function parseBlocks(content: string): Block[] {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: Block[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];

  function flushParagraph() {
    if (paragraph.length === 0) return;
    blocks.push({ type: "paragraph", text: paragraph.join("\n").trim() });
    paragraph = [];
  }

  function flushList() {
    if (listItems.length === 0) return;
    blocks.push({ type: "list", items: listItems });
    listItems = [];
  }

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const heading = /^(#{1,3})\s+(.+)$/.exec(line);
    if (heading) {
      flushParagraph();
      flushList();
      blocks.push({
        type: "heading",
        level: heading[1].length as 1 | 2 | 3,
        text: heading[2].trim(),
      });
      continue;
    }

    if (/^[-*]\s+/.test(line)) {
      flushParagraph();
      listItems.push(line.replace(/^[-*]\s+/, "").trim());
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      flushParagraph();
      listItems.push(line.replace(/^\d+\.\s+/, "").trim());
      continue;
    }

    if (line.startsWith(">")) {
      flushParagraph();
      flushList();
      blocks.push({ type: "quote", text: line.replace(/^>\s?/, "").trim() });
      continue;
    }

    flushList();
    paragraph.push(rawLine);
  }

  flushParagraph();
  flushList();
  return blocks;
}

function renderBlock(block: Block, index: number) {
  if (block.type === "heading") {
    const className = block.level === 1 || block.level === 2
      ? "mb-4 mt-8 font-serif text-xl font-semibold text-[#1f2937]"
      : "mb-3 mt-6 font-serif text-lg font-semibold text-[#1f2937]";
    return block.level === 1 || block.level === 2
      ? <h2 key={index} className={className}>{inlineText(block.text)}</h2>
      : <h3 key={index} className={className}>{inlineText(block.text)}</h3>;
  }

  if (block.type === "quote") {
    return (
      <blockquote key={index} className="my-5 border-l-4 border-[#5eead4] bg-[#f0fdfa] px-4 py-3 text-[#115e59]">
        {inlineText(block.text)}
      </blockquote>
    );
  }

  if (block.type === "list") {
    return (
      <ul key={index} className="my-5 list-disc space-y-2 pl-6">
        {block.items.map((item, itemIndex) => <li key={itemIndex}>{inlineText(item)}</li>)}
      </ul>
    );
  }

  return <p key={index}>{inlineText(block.text)}</p>;
}

function inlineText(text: string) {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}
