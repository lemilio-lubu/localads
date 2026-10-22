import type { MulterOptions } from "@nestjs/platform-express/multer/interfaces/multer-options.interface";

/* Subida de comprobantes, igual para el cliente y para el equipo.
   defParamCharset: los navegadores envían el nombre del archivo en UTF-8 y
   multer lo lee como latin1 si no se le dice; «año» llegaba como «aÃ±o». */
export const receiptUploadOptions: MulterOptions = {
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  defParamCharset: "utf8",
};
