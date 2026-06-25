// Client-side PDF rendering with pdf.js. For each page we extract the text layer
// and a rasterized PNG (both fed to Claude for member extraction). Runs entirely
// in the browser — no server needed.
import * as pdfjsLib from "pdfjs-dist";
// Vite resolves ?url to a hashed asset URL that respects the Pages base path.
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

export interface RenderedPage {
  page_no: number;
  text: string;
  image_b64: string; // base64 PNG (no data: prefix)
}

const MAX_PX = 2000; // cap the longest edge to bound image token cost

export async function renderPdf(
  file: File,
  onProgress?: (msg: string) => void
): Promise<RenderedPage[]> {
  const data = new Uint8Array(await file.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;
  const out: RenderedPage[] = [];
  try {
    for (let n = 1; n <= pdf.numPages; n++) {
      onProgress?.(`Rendering ${file.name} — page ${n}/${pdf.numPages}…`);
      const page = await pdf.getPage(n);

      const content = await page.getTextContent();
      const text = content.items
        .map((it: any) => (typeof it.str === "string" ? it.str : ""))
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();

      let viewport = page.getViewport({ scale: 2 });
      const longest = Math.max(viewport.width, viewport.height);
      if (longest > MAX_PX) viewport = page.getViewport({ scale: (2 * MAX_PX) / longest });

      const canvas = document.createElement("canvas");
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not get a 2D canvas context for PDF rendering");
      await page.render({ canvas, canvasContext: ctx, viewport } as any).promise;
      const image_b64 = canvas.toDataURL("image/png").split(",")[1] || "";

      out.push({ page_no: n, text, image_b64 });
      page.cleanup();
    }
  } finally {
    (pdf as any).destroy?.();
  }
  return out;
}
