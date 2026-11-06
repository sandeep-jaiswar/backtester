/**
 * Reads a newline-delimited JSON response and calls `onEvent` for each parsed line.
 * Lines that do not parse are skipped. Works on any Response with a body stream.
 */
export async function readNdjson<T>(res: Response, onEvent: (event: T) => void): Promise<void> {
  if (!res.body) throw new Error("Empty response");
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        onEvent(JSON.parse(line) as T);
      } catch {
        // Ignore malformed lines.
      }
    }
  }
  const rest = buffer.trim();
  if (rest) {
    try {
      onEvent(JSON.parse(rest) as T);
    } catch {
      // Ignore a trailing partial line.
    }
  }
}
