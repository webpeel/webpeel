/**
 * PDF extraction using pdf-parse
 */

export async function extractPdf(buffer: Buffer): Promise<{ text: string; metadata: Record<string, any>; pages: number }> {
  try {
    const pdfParse = (await import('pdf-parse')).default;
    // pdf-parse (pdfjs) requires Uint8Array — passing a Node Buffer causes xref parse errors.
    // The type definitions say Buffer, but at runtime pdfjs needs a plain Uint8Array.
    const data = await pdfParse(new Uint8Array(buffer) as unknown as Buffer);
    return {
      text: data.text,
      metadata: {
        title: data.info?.Title || '',
        author: data.info?.Author || '',
        creator: data.info?.Creator || '',
        producer: data.info?.Producer || '',
        creationDate: data.info?.CreationDate || '',
      },
      pages: data.numpages,
    };
  } catch (error) {
    throw new Error(`PDF parsing failed: ${error instanceof Error ? error.message : 'Unknown error'}. Install pdf-parse: npm install pdf-parse`);
  }
}
