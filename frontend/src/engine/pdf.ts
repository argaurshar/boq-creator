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

const MAX_PX = 2600; // longest edge — higher res so small dimension text is legible
// Anthropic refuses an image over 5 MB (base64), and a gateway in front of it
// may have a smaller body limit still and answer with an opaque 500. A dense
// drawing rasterised at 2600px can pass either. Stay comfortably under, and
// step the page down until it fits rather than failing the whole run.
const MAX_IMAGE_B64 = 3_600_000;
const MIN_PX = 900; // below this the dimension text stops being legible anyway

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

      const base = page.getViewport({ scale: 1 });
      const longest = Math.max(base.width, base.height);
      let px = Math.min(MAX_PX, longest * 2);
      let image_b64 = "";
      // Render, and if the encoded page is too big for the provider to accept,
      // render it again smaller. Two or three steps is plenty in practice.
      while (true) {
        const viewport = page.getViewport({ scale: px / longest });
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Could not get a 2D canvas context for PDF rendering");
        await page.render({ canvas, canvasContext: ctx, viewport } as any).promise;
        image_b64 = canvas.toDataURL("image/png").split(",")[1] || "";
        if (image_b64.length <= MAX_IMAGE_B64 || px <= MIN_PX) break;
        px = Math.max(MIN_PX, Math.round(px * 0.75));
        onProgress?.(`Page ${n} is a heavy drawing — re-rendering it smaller so it can be sent…`);
      }

      out.push({ page_no: n, text, image_b64 });
      page.cleanup();
    }
  } finally {
    (pdf as any).destroy?.();
  }
  return out;
}
