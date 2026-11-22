import type { Area } from 'react-easy-crop';

const AVATAR_SIZE = 512;

function createImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.addEventListener('load', () => resolve(image));
    image.addEventListener('error', reject);
    image.src = src;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) {
        resolve(blob);
        return;
      }

      reject(new Error('Could not create cropped avatar image.'));
    }, 'image/png');
  });
}

export async function getCroppedAvatarFile(imageSrc: string, pixelCrop: Area) {
  const image = await createImage(imageSrc);
  const cropX = Math.round(pixelCrop.x);
  const cropY = Math.round(pixelCrop.y);
  const cropWidth = Math.round(pixelCrop.width);
  const cropHeight = Math.round(pixelCrop.height);

  const outputCanvas = document.createElement('canvas');
  const outputContext = outputCanvas.getContext('2d');

  if (!outputContext) {
    throw new Error('Could not create canvas context.');
  }

  outputCanvas.width = AVATAR_SIZE;
  outputCanvas.height = AVATAR_SIZE;
  outputContext.imageSmoothingEnabled = true;
  outputContext.imageSmoothingQuality = 'high';
  outputContext.drawImage(
    image,
    cropX,
    cropY,
    cropWidth,
    cropHeight,
    0,
    0,
    AVATAR_SIZE,
    AVATAR_SIZE
  );

  const blob = await canvasToBlob(outputCanvas);
  return new File([blob], 'avatar.png', { type: 'image/png' });
}
