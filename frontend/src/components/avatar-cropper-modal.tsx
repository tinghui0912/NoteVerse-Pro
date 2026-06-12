
'use client';

import { useTranslations } from 'next-intl';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import {
  X,
  RotateCcw,
  RotateCw,
  ZoomIn,
  ZoomOut,
  ArrowLeftRight,
  ArrowUpDown,
} from 'lucide-react';
import React, { useState, useRef, useEffect } from 'react';
import ReactCrop, {
  type Crop,
  centerCrop,
  makeAspectCrop,
} from 'react-image-crop';
import 'react-image-crop/dist/ReactCrop.css';
import { ScrollArea } from './ui/scroll-area';

function getCroppedImg(
  image: HTMLImageElement,
  crop: Crop,
  canvas: HTMLCanvasElement
) {
  const scaleX = image.naturalWidth / image.width;
  const scaleY = image.naturalHeight / image.height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('No 2d context');
  }

  const pixelRatio = window.devicePixelRatio;
  canvas.width = Math.floor(crop.width * scaleX * pixelRatio);
  canvas.height = Math.floor(crop.height * scaleY * pixelRatio);

  ctx.scale(pixelRatio, pixelRatio);
  ctx.imageSmoothingQuality = 'high';

  const cropX = crop.x * scaleX;
  const cropY = crop.y * scaleY;
  const centerX = image.naturalWidth / 2;
  const centerY = image.naturalHeight / 2;

  ctx.save();

  // 5) Move the crop origin to the canvas origin (0,0)
  ctx.translate(-cropX, -cropY);
  // 4) Move the origin to the center of the original position
  ctx.translate(centerX, centerY);
  // 3) Rotate around the center
  ctx.rotate((0 * Math.PI) / 180); // This was `rotate` state, but it is not passed here. It seems the library handles rotation in CSS, not on canvas.
  // 2) Scale the image
  ctx.scale(1, 1); // This was `flip`, but not passed.
  // 1) Move the center of the image to the origin (0,0)
  ctx.translate(-centerX, -centerY);
  ctx.drawImage(
    image,
    0,
    0,
    image.naturalWidth,
    image.naturalHeight
  );

  ctx.restore();

  return new Promise<string>((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        throw new Error('Canvas is empty');
      }
      resolve(URL.createObjectURL(blob));
    }, 'image/png');
  });
}


export function AvatarCropperModal({
  isOpen,
  onClose,
  imageSrc,
  onSave,
}: {
  isOpen: boolean;
  onClose: () => void;
  imageSrc: string;
  onSave: (image: string) => void;
}) {
  const t = useTranslations('common');
  const tProfile = useTranslations('profile');
  const [crop, setCrop] = useState<Crop>();
  const [completedCrop, setCompletedCrop] = useState<Crop>();
  const [scale, setScale] = useState(1);
  const [rotate, setRotate] = useState(0);
  const [flip, setFlip] = useState({ horizontal: false, vertical: false });
  const imgRef = useRef<HTMLImageElement>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (
      completedCrop?.width &&
      completedCrop?.height &&
      imgRef.current &&
      previewCanvasRef.current
    ) {
      // We'll draw the preview with the rotation in CSS transform, not here.
      // The actual saving will handle the rotation on a new canvas.
      getCroppedImg(imgRef.current, completedCrop, previewCanvasRef.current);
    }
  }, [completedCrop]);
  
  function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const { width, height } = e.currentTarget;
    const crop = centerCrop(
      makeAspectCrop(
        {
          unit: '%',
          width: 90,
        },
        1, // aspect ratio 1:1
        width,
        height
      ),
      width,
      height
    );
    setCrop(crop);
    setCompletedCrop(crop);
  }

  const handleSave = async () => {
    const image = imgRef.current;
    if (!image || !completedCrop) {
      throw new Error('Crop details not available');
    }

    const canvas = document.createElement('canvas');
    const scaleX = image.naturalWidth / image.width;
    const scaleY = image.naturalHeight / image.height;
    
    canvas.width = Math.floor(completedCrop.width * scaleX);
    canvas.height = Math.floor(completedCrop.height * scaleY);

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('No 2d context');
    }

    const cropX = completedCrop.x * scaleX;
    const cropY = completedCrop.y * scaleY;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.rotate((rotate * Math.PI) / 180);
    ctx.scale(flip.horizontal ? -1 : 1, flip.vertical ? -1 : 1);
    ctx.translate(-centerX, -centerY);
    
    ctx.drawImage(
      image,
      cropX,
      cropY,
      completedCrop.width * scaleX,
      completedCrop.height * scaleY,
      0,
      0,
      canvas.width,
      canvas.height
    );

    ctx.restore();

    const base64Image = canvas.toDataURL('image/png');
    onSave(base64Image);
    onClose();
  };
  
  const handleRotate = (angle: number) => {
    setRotate(prevRotate => prevRotate + angle);
  };

  const handleReset = () => {
      setScale(1);
      setRotate(0);
      setFlip({ horizontal: false, vertical: false });
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl p-0 flex flex-col max-h-[90vh]">
        <DialogHeader className="p-4 border-b">
          <DialogTitle>{tProfile('cropAvatar')}</DialogTitle>
          <DialogClose className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogClose>
        </DialogHeader>

        <ScrollArea className="flex-1">
          <div className="p-6">
              <div className="flex items-center justify-center gap-1 sm:gap-4 mb-4 p-2 bg-gray-100 rounded-md">
                  <Button variant="ghost" size="icon" onClick={() => handleRotate(-90)}><RotateCcw className="h-5 w-5"/></Button>
                  <Button variant="ghost" size="icon" onClick={() => handleRotate(90)}><RotateCw className="h-5 w-5"/></Button>
                  <Button variant="ghost" size="icon" onClick={() => setFlip(f => ({ ...f, horizontal: !f.horizontal }))}><ArrowLeftRight className="h-5 w-5"/></Button>
                  <Button variant="ghost" size="icon" onClick={() => setFlip(f => ({ ...f, vertical: !f.vertical }))}><ArrowUpDown className="h-5 w-5"/></Button>
                  <Button variant="ghost" size="icon" onClick={() => setScale(s => s * 1.2)}><ZoomIn className="h-5 w-5"/></Button>
                  <Button variant="ghost" size="icon" onClick={() => setScale(s => s / 1.2)}><ZoomOut className="h-5 w-5"/></Button>
                  <Button variant="ghost" size="icon" onClick={handleReset}><RotateCcw className="h-5 w-5"/></Button>
              </div>
              <div className="w-full bg-gray-200/50 rounded-lg p-2 flex items-center justify-center min-h-[300px] md:min-h-[400px]">
                {imageSrc && (
                    <ReactCrop
                    crop={crop}
                    onChange={(_, percentCrop) => setCrop(percentCrop)}
                    onComplete={(c) => setCompletedCrop(c)}
                    aspect={1}
                    circularCrop
                    >
                    {/* eslint-disable-next-line @next/next/no-img-element -- ReactCrop needs a native image element for canvas-based crop extraction. */}
                    <img
                        ref={imgRef}
                        alt="Crop me"
                        src={imageSrc}
                        style={{
                            transform: `scale(${scale}) rotate(${rotate}deg) scaleX(${flip.horizontal ? -1 : 1}) scaleY(${flip.vertical ? -1 : 1})`,
                            maxHeight: '60vh',
                            objectFit: 'contain'
                        }}
                        onLoad={onImageLoad}
                    />
                    </ReactCrop>
                )}
              </div>
          </div>
        </ScrollArea>

        <DialogFooter className="p-4 border-t bg-gray-50/80">
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={handleSave}>{tProfile('saveAvatar')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
