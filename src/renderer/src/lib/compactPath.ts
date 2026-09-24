export function compactPath(path: string, maxLength = 64): string {
  if (path.length <= maxLength) return path;
  const parts = path.split("/").filter(Boolean);
  if (parts.length < 3) return path;
  const prefix = path.startsWith("/") ? "/" : "";
  let head = 1;
  let tail = parts.length - 1;
  const format = (start: number, end: number) =>
    `${prefix}${parts.slice(0, start).join("/")}/.../${parts.slice(end).join("/")}`;
  while (tail > head + 1 && format(head, tail - 1).length <= maxLength) tail -= 1;
  while (head + 1 < tail && format(head + 1, tail).length <= maxLength) head += 1;
  return format(head, tail);
}
