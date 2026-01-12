/**
 * RGB565 conversion regression tests
 *
 * Bug: PNG images with alpha channels (RGBA, 4 bytes/pixel) caused channel
 * misalignment because the conversion loop assumed 3 bytes/pixel (RGB).
 *
 * Fix: Handle RGBA (4 bytes/pixel) from image bitmap data
 *
 * Issue: https://github.com/open-horizon-labs/unified-hifi-control/issues/35
 * Forum: https://forums.lyrion.org/forum/user-forums/3rd-party-hardware/1804977-roon-knob-includes-lms-support?p=1805839#post1805839
 */

const { read: readImage, resize: resizeImage, encodeJpeg } = require('../lib/image');

function convertToRgb565(rgba, width, height) {
  const rgb565 = Buffer.alloc(width * height * 2);
  for (let i = 0; i < rgba.length; i += 4) {
    const r = rgba[i] >> 3;
    const g = rgba[i + 1] >> 2;
    const b = rgba[i + 2] >> 3;
    // Skip alpha at rgba[i + 3]
    const rgb565Pixel = (r << 11) | (g << 5) | b;
    const pixelIndex = (i / 4) * 2;
    rgb565[pixelIndex] = rgb565Pixel & 0xff;
    rgb565[pixelIndex + 1] = (rgb565Pixel >> 8) & 0xff;
  }
  return rgb565;
}

describe('RGB565 conversion with pure JS image processing', () => {
  const targetWidth = 10;
  const targetHeight = 10;

  test('resize produces RGBA bitmap (4 bytes per pixel)', () => {
    // Create a test image: 20x20 red pixels
    const srcWidth = 20;
    const srcHeight = 20;
    const src = {
      width: srcWidth,
      height: srcHeight,
      data: Buffer.alloc(srcWidth * srcHeight * 4)
    };
    // Fill with red (RGBA)
    for (let i = 0; i < src.data.length; i += 4) {
      src.data[i] = 255;     // R
      src.data[i + 1] = 0;   // G
      src.data[i + 2] = 0;   // B
      src.data[i + 3] = 255; // A
    }

    const resized = resizeImage(src, targetWidth, targetHeight);

    // Result should be RGBA (4 bytes per pixel)
    expect(resized.data.length).toBe(targetWidth * targetHeight * 4);
    expect(resized.width).toBe(targetWidth);
    expect(resized.height).toBe(targetHeight);
  });

  test('RGB565 output size is correct', () => {
    // Create a test image: 20x20 purple pixels
    const srcWidth = 20;
    const srcHeight = 20;
    const src = {
      width: srcWidth,
      height: srcHeight,
      data: Buffer.alloc(srcWidth * srcHeight * 4)
    };
    // Fill with purple (RGBA)
    for (let i = 0; i < src.data.length; i += 4) {
      src.data[i] = 128;     // R
      src.data[i + 1] = 64;  // G
      src.data[i + 2] = 192; // B
      src.data[i + 3] = 255; // A
    }

    const resized = resizeImage(src, targetWidth, targetHeight);
    const rgb565 = convertToRgb565(resized.data, targetWidth, targetHeight);

    expect(rgb565.length).toBe(targetWidth * targetHeight * 2);
  });

  test('can encode and decode JPEG', () => {
    // Create a test image: 100x100 green pixels
    const srcWidth = 100;
    const srcHeight = 100;
    const src = {
      width: srcWidth,
      height: srcHeight,
      data: Buffer.alloc(srcWidth * srcHeight * 4)
    };
    // Fill with green (RGBA)
    for (let i = 0; i < src.data.length; i += 4) {
      src.data[i] = 0;       // R
      src.data[i + 1] = 255; // G
      src.data[i + 2] = 0;   // B
      src.data[i + 3] = 255; // A
    }

    // Encode to JPEG
    const jpegBuffer = encodeJpeg(src, 80);
    expect(jpegBuffer).toBeInstanceOf(Buffer);
    expect(jpegBuffer.length).toBeGreaterThan(0);

    // Decode and resize
    const decoded = readImage(jpegBuffer);
    const resized = resizeImage(decoded, targetWidth, targetHeight);

    expect(resized.width).toBe(targetWidth);
    expect(resized.height).toBe(targetHeight);
  });
});
