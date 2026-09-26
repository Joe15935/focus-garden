/** Browser side of screenshot import: decode the PNG the Mac converted, then parse. */
import { studyCommand } from "./api";
import type * as C from "./core";
import { localToday } from "./model";
import {
  detectCards,
  draftsFromShots,
  fromVision,
  type ParsedShot,
  parseShot,
  readLayout,
  type ShotImport,
} from "./timetable-ocr";

interface OcrImage {
  name: string;
  data_url: string;
  boxes: { text: string; x: number; y: number; w: number; h: number }[];
}

async function pixels(dataUrl: string): Promise<ImageData> {
  const image = new Image();
  image.src = dataUrl;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  if (!context) throw new Error("无法读取截图像素");
  context.drawImage(image, 0, 0);
  return context.getImageData(0, 0, canvas.width, canvas.height);
}

/** Asks the Mac to OCR user-picked screenshots, then builds rule drafts for `semester`. */
export async function importScreenshots(
  semester: C.Semester,
): Promise<(ShotImport & { shots: ParsedShot[] }) | null> {
  const images = await studyCommand<OcrImage[] | null>("ocr_images");
  if (!images?.length) return null;
  const today = localToday();
  const shots: ParsedShot[] = [];
  for (const image of images) {
    const data = await pixels(image.data_url);
    const texts = fromVision(image.boxes, data.width, data.height);
    const layout = readLayout(texts, data.height, today);
    const cards = detectCards(
      data,
      layout.columns.map((c) => c.x),
      layout.colWidth,
      layout.gridTop,
      layout.gridBottom,
    );
    shots.push(parseShot(image.name, texts, data.height, cards, today));
  }
  return { ...draftsFromShots(shots, semester), shots };
}
