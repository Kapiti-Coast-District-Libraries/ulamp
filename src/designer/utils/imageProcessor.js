// src/designer/utils/imageProcessor.js

export function processImageToHeightmap(file, resolution = 256) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = resolution;
        canvas.height = resolution;
        const ctx = canvas.getContext('2d');

        // Draw image stretched/scaled onto canvas
        ctx.drawImage(img, 0, 0, resolution, resolution);
        const imgData = ctx.getImageData(0, 0, resolution, resolution);

        resolve({
          data: imgData,
          width: resolution,
          height: resolution,
          previewUrl: event.target.result
        });
      };
      img.onerror = reject;
    };
  });
}
