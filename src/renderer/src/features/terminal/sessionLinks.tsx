import type { ReactNode } from "react";

function externalUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

export function openSessionLink(_event: MouseEvent, value: string): void {
  const url = externalUrl(value);
  if (url) window.open(url, "_blank", "noopener,noreferrer");
}

export function linkifySessionOutput(output: string): ReactNode[] {
  const parts: ReactNode[] = [];
  const pattern = /https?:\/\/[^\s<>"']+/g;
  let previousEnd = 0;
  for (const match of output.matchAll(pattern)) {
    const start = match.index;
    const raw = match[0];
    const value = raw.replace(/[),.;!?\]}]+$/, "");
    const url = externalUrl(value);
    if (!url) continue;
    parts.push(output.slice(previousEnd, start));
    parts.push(<a
      key={start}
      href={url}
      className="underline decoration-transparent hover:decoration-current"
      onClick={(event) => {
        event.preventDefault();
      }}
      onMouseUp={(event) => {
        if (event.button === 0) openSessionLink(event.nativeEvent, url);
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          window.open(url, "_blank", "noopener,noreferrer");
        }
      }}
    >{value}</a>);
    previousEnd = start + value.length;
  }
  parts.push(output.slice(previousEnd));
  return parts;
}
