/**
 * DFBnet CSV exports are frequently written as Windows-1252 / ISO-8859-1, not
 * UTF-8. Decoding those bytes as UTF-8 replaces every umlaut (ä ö ü ß) with the
 * replacement character. Detect the BOM, otherwise try strict UTF-8 first and
 * fall back to Windows-1252 so names round-trip intact on import.
 */
export function decodeCsvBytes(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  if (view[0] === 0xef && view[1] === 0xbb && view[2] === 0xbf) return new TextDecoder("utf-8").decode(view.subarray(3));
  if (view[0] === 0xff && view[1] === 0xfe) return new TextDecoder("utf-16le").decode(view.subarray(2));
  if (view[0] === 0xfe && view[1] === 0xff) return new TextDecoder("utf-16be").decode(view.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(view);
  } catch {
    return new TextDecoder("windows-1252").decode(view);
  }
}

/** Read a picked CSV file to text, preserving umlauts regardless of source encoding. */
export async function readCsvFile(file: Blob): Promise<string> {
  return decodeCsvBytes(await file.arrayBuffer());
}
