/**
 * Pure JS image processing - zero native dependencies
 *
 * Replaces jimp for simple resize + RGB565 conversion needs.
 * Uses jpeg-js for JPEG decode/encode.
 */

const jpeg = require('jpeg-js');

/**
 * Decode a JPEG buffer to RGBA pixel data
 * @param {Buffer} buffer - JPEG image data
 * @returns {{width: number, height: number, data: Buffer}} - RGBA bitmap
 */
function decodeJpeg(buffer) {
  const decoded = jpeg.decode(buffer, { useTArray: true });
  return {
    width: decoded.width,
    height: decoded.height,
    data: Buffer.from(decoded.data)
  };
}

/**
 * Encode RGBA pixel data to JPEG buffer
 * @param {{width: number, height: number, data: Buffer}} image - RGBA bitmap
 * @param {number} quality - JPEG quality 0-100 (default 80)
 * @returns {Buffer} - JPEG image data
 */
function encodeJpeg(image, quality = 80) {
  const encoded = jpeg.encode({
    width: image.width,
    height: image.height,
    data: image.data
  }, quality);
  return encoded.data;
}

/**
 * Bilinear resize of RGBA image
 * @param {{width: number, height: number, data: Buffer}} src - Source RGBA bitmap
 * @param {number} dstWidth - Target width
 * @param {number} dstHeight - Target height
 * @returns {{width: number, height: number, data: Buffer}} - Resized RGBA bitmap
 */
function resize(src, dstWidth, dstHeight) {
  const srcData = src.data;
  const srcWidth = src.width;
  const srcHeight = src.height;

  const dstData = Buffer.alloc(dstWidth * dstHeight * 4);

  const xRatio = srcWidth / dstWidth;
  const yRatio = srcHeight / dstHeight;

  for (let y = 0; y < dstHeight; y++) {
    for (let x = 0; x < dstWidth; x++) {
      // Map destination pixel to source coordinates
      const srcX = x * xRatio;
      const srcY = y * yRatio;

      // Get the four nearest source pixels
      const x0 = Math.floor(srcX);
      const y0 = Math.floor(srcY);
      const x1 = Math.min(x0 + 1, srcWidth - 1);
      const y1 = Math.min(y0 + 1, srcHeight - 1);

      // Interpolation weights
      const xWeight = srcX - x0;
      const yWeight = srcY - y0;

      // Get pixel indices (4 bytes per pixel: RGBA)
      const i00 = (y0 * srcWidth + x0) * 4;
      const i10 = (y0 * srcWidth + x1) * 4;
      const i01 = (y1 * srcWidth + x0) * 4;
      const i11 = (y1 * srcWidth + x1) * 4;

      // Bilinear interpolation for each channel
      const dstIndex = (y * dstWidth + x) * 4;
      for (let c = 0; c < 4; c++) {
        const top = srcData[i00 + c] * (1 - xWeight) + srcData[i10 + c] * xWeight;
        const bottom = srcData[i01 + c] * (1 - xWeight) + srcData[i11 + c] * xWeight;
        dstData[dstIndex + c] = Math.round(top * (1 - yWeight) + bottom * yWeight);
      }
    }
  }

  return {
    width: dstWidth,
    height: dstHeight,
    data: dstData
  };
}

/**
 * Read image from buffer (JPEG only for now)
 * @param {Buffer} buffer - Image data
 * @returns {{width: number, height: number, data: Buffer}} - RGBA bitmap
 */
function read(buffer) {
  // Check for JPEG magic bytes (FFD8FF)
  if (buffer[0] === 0xFF && buffer[1] === 0xD8 && buffer[2] === 0xFF) {
    return decodeJpeg(buffer);
  }
  throw new Error('Unsupported image format (only JPEG supported)');
}

module.exports = {
  read,
  resize,
  encodeJpeg,
  decodeJpeg
};
