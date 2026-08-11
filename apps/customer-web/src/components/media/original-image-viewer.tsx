'use client';

import { useTranslations } from 'next-intl';

import React, { useState, useRef, useEffect } from 'react';
import { FloatingWindow } from '@/components/ui/floating-window';
import { EmptyState } from '@/components/states';
import { Button } from '@/components/ui/button';
import { ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize, FileImage } from 'lucide-react';
import Image from 'next/image';

interface ImageViewerProps {
  images: { src: string; alt: string }[];
  isOpen: boolean;
  onClose: () => void;
}

export function OriginalImageViewer({ images, isOpen, onClose }: ImageViewerProps) {
  const tReview = useTranslations('review');
  const scoreText = useTranslations('score');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [scale, setScale] = useState(1);
  const [panPosition, setPanPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 });

  const defaultSize = { width: 500, height: 600 };
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [size, setSize] = useState(defaultSize);

  useEffect(() => {
    if (isOpen) {
      const vw = window.innerWidth;
      const vh = window.innerHeight;

      const newWidth = Math.min(size.width || defaultSize.width, vw - 40);
      const newHeight = Math.min(size.height || defaultSize.height, vh - 40);

      // Only set initial position if it's the very first open
      if (position.x === 0 && position.y === 0) {
        setPosition({
          x: Math.max(20, (vw - newWidth) / 2),
          y: Math.max(20, (vh - newHeight) / 2),
        });
      }

      if (size.width === defaultSize.width && size.height === defaultSize.height) {
        setSize({ width: newWidth, height: newHeight });
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);


  const resetView = () => {
    setScale(1);
    setPanPosition({ x: 0, y: 0 });
  };

  useEffect(() => {
    resetView();
  }, [currentIndex]);

  const goToPrevious = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((prevIndex) => (prevIndex === 0 ? images.length - 1 : prevIndex - 1));
  };

  const goToNext = (e: React.MouseEvent) => {
    e.stopPropagation();
    setCurrentIndex((prevIndex) => (prevIndex === images.length - 1 ? 0 : prevIndex + 1));
  };

  useEffect(() => {
    const imageContainer = imageContainerRef.current;
    if (!imageContainer) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      const scaleAmount = -e.deltaY * 0.001;
      setScale(prevScale => Math.max(0.1, prevScale + scaleAmount));
    };

    if (isOpen) {
      imageContainer.addEventListener('wheel', handleWheel, { passive: false });
    }

    return () => {
      if (imageContainer) {
        imageContainer.removeEventListener('wheel', handleWheel);
      }
    };
  }, [isOpen]);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (!imageContainerRef.current || (e.target as HTMLElement).closest('button')) return;
    e.preventDefault();
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      posX: panPosition.x,
      posY: panPosition.y,
    };
    if (imageContainerRef.current) imageContainerRef.current.style.cursor = 'grabbing';
  };

  useEffect(() => {
    const handleMove = (clientX: number, clientY: number) => {
      if (!isDragging) return;

      const dx = clientX - dragStartRef.current.x;
      const dy = clientY - dragStartRef.current.y;
      setPanPosition({
        x: dragStartRef.current.posX + dx,
        y: dragStartRef.current.posY + dy,
      });
    };

    const handleMouseMove = (e: MouseEvent) => handleMove(e.clientX, e.clientY);
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        handleMove(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    const handleUp = () => {
      setIsDragging(false);
      if (imageContainerRef.current) {
        imageContainerRef.current.style.cursor = 'grab';
      }
    };

    if (isDragging) {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleUp);
      document.addEventListener('touchmove', handleTouchMove, { passive: true });
      document.addEventListener('touchend', handleUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleUp);
    };

  }, [isDragging]);

  useEffect(() => {
    const imageContainer = imageContainerRef.current;

    const handleTouchStart = (e: TouchEvent) => {
      if ((e.target as HTMLElement).closest('button')) return;
      e.preventDefault();

      setIsDragging(true);
      const touch = e.touches[0];
      dragStartRef.current = {
        x: touch.clientX,
        y: touch.clientY,
        posX: panPosition.x,
        posY: panPosition.y,
      };
      if (imageContainer) imageContainer.style.cursor = 'grabbing';
    };

    if (imageContainer) {
      imageContainer.addEventListener('touchstart', handleTouchStart, { passive: false });
    }

    return () => {
      if (imageContainer) {
        imageContainer.removeEventListener('touchstart', handleTouchStart);
      }
    }
  }, [panPosition.x, panPosition.y]);


  // Render the empty-image state inside the floating window instead of returning null.
  const hasImages = images && images.length > 0;

  return (
    <FloatingWindow
      title={hasImages ? `${tReview('originalScore')} (${currentIndex + 1}/${images.length})` : tReview('originalScore')}
      isOpen={isOpen}
      onClose={onClose}
      position={position}
      onPositionChange={setPosition}
      size={size}
      onSizeChange={setSize}
    >
      {hasImages ? (
        <div
          ref={imageContainerRef}
          className="relative w-full h-full bg-muted/20 rounded-md overflow-hidden cursor-grab"
          onMouseDown={handleMouseDown}
        >
          <div
            className="absolute inset-0 transition-transform duration-100 ease-linear"
            style={{
              transform: `translate(${panPosition.x}px, ${panPosition.y}px) scale(${scale})`,
              transformOrigin: 'center center'
            }}
          >
            <Image
              src={images[currentIndex].src}
              alt={images[currentIndex].alt}
              fill
              unoptimized
              className="object-contain"
              draggable="false"
            />
          </div>

          <div className="absolute top-2 left-1/2 -translate-x-1/2 flex items-center gap-1 bg-background/80 backdrop-blur-sm p-1 rounded-full shadow-lg border">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setScale(s => s * 1.2)}><ZoomIn className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setScale(s => s / 1.2)}><ZoomOut className="h-4 w-4" /></Button>
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={resetView}><Maximize className="h-4 w-4" /></Button>
          </div>

          {images.length > 1 && (
            <>
              <Button
                variant="outline"
                size="icon"
                className="absolute top-1/2 left-2 -translate-y-1/2 h-8 w-8 rounded-full bg-white/80 backdrop-blur-sm shadow-md hover:bg-white"
                onClick={goToPrevious}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                className="absolute top-1/2 right-2 -translate-y-1/2 h-8 w-8 rounded-full bg-white/80 backdrop-blur-sm shadow-md hover:bg-white"
                onClick={goToNext}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </>
          )}
        </div>
      ) : (
        <EmptyState
          icon={FileImage}
          title={scoreText('noImageAvailable')}
          className="h-full w-full rounded-md bg-gray-100"
        />
      )}
    </FloatingWindow>
  );
}
