'use client';

import React, { useState, useRef, useEffect } from 'react';
import { X } from 'lucide-react';
import { Button } from './button';

interface FloatingWindowProps {
  children: React.ReactNode;
  title: string;
  isOpen: boolean;
  onClose: () => void;
  position: { x: number; y: number };
  onPositionChange: (position: { x: number; y: number }) => void;
  size: { width: number; height: number };
  onSizeChange: (size: { width: number; height: number }) => void;
}

export function FloatingWindow({
  children,
  title,
  isOpen,
  onClose,
  position,
  onPositionChange,
  size,
  onSizeChange,
}: FloatingWindowProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  const windowRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLDivElement>(null);
  const resizeHandleRef = useRef<HTMLDivElement>(null);
  const dragStartRef = useRef<{ x: number; y: number; posX: number; posY: number } | null>(null);
  const resizeStartRef = useRef<{ x: number; y: number; width: number; height: number } | null>(null);


  // Effect for handling move and up/end events (both mouse and touch)
  useEffect(() => {
    const handleMove = (clientX: number, clientY: number, event: MouseEvent | TouchEvent) => {
      if (isDragging && dragStartRef.current) {
        event.preventDefault();
        const dx = clientX - dragStartRef.current.x;
        const dy = clientY - dragStartRef.current.y;
        
        const newX = dragStartRef.current.posX + dx;
        const newY = dragStartRef.current.posY + dy;

        const maxX = window.innerWidth - size.width;
        const maxY = window.innerHeight - size.height;

        onPositionChange({
          x: Math.max(0, Math.min(newX, maxX)),
          y: Math.max(0, Math.min(newY, maxY)),
        });
      }
      if (isResizing && resizeStartRef.current) {
        event.preventDefault();
        const dw = clientX - resizeStartRef.current.x;
        const dh = clientY - resizeStartRef.current.y;
        const newWidth = Math.max(300, resizeStartRef.current.width + dw);
        const newHeight = Math.max(200, resizeStartRef.current.height + dh);

        onSizeChange({ width: newWidth, height: newHeight });
      }
    };

    const handleMouseMove = (e: MouseEvent) => handleMove(e.clientX, e.clientY, e);
    const handleTouchMove = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        handleMove(e.touches[0].clientX, e.touches[0].clientY, e);
      }
    };

    const handleUp = () => {
      setIsDragging(false);
      setIsResizing(false);
      dragStartRef.current = null;
      resizeStartRef.current = null;
    };

    if (isDragging || isResizing) {
      document.addEventListener('mousemove', handleMouseMove, { passive: false });
      document.addEventListener('mouseup', handleUp);
      document.addEventListener('touchmove', handleTouchMove, { passive: false });
      document.addEventListener('touchend', handleUp);
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleUp);
      document.removeEventListener('touchmove', handleTouchMove);
      document.removeEventListener('touchend', handleUp);
    };
  }, [isDragging, isResizing, size, onPositionChange, onSizeChange]);


  // Effect for handling the initial "down" event (both mouse and touch)
  useEffect(() => {
    if (!isOpen) return;

    const header = headerRef.current;
    const resizeHandle = resizeHandleRef.current;

    const handleDragStart = (clientX: number, clientY: number, target: EventTarget | null) => {
        if ((target as HTMLElement)?.closest('button')) return;
        setIsDragging(true);
        dragStartRef.current = { x: clientX, y: clientY, posX: position.x, posY: position.y };
    };

    const handleResizeStart = (clientX: number, clientY: number) => {
        setIsResizing(true);
        resizeStartRef.current = { x: clientX, y: clientY, width: size.width, height: size.height };
    };

    const handleMouseDown = (e: MouseEvent) => {
      handleDragStart(e.clientX, e.clientY, e.target);
    };

    const handleTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        handleDragStart(e.touches[0].clientX, e.touches[0].clientY, e.target);
      }
    };

    const handleResizeMouseDown = (e: MouseEvent) => {
      e.preventDefault();
      handleResizeStart(e.clientX, e.clientY);
    };

    const handleResizeTouchStart = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        e.preventDefault();
        handleResizeStart(e.touches[0].clientX, e.touches[0].clientY);
      }
    };

    if (header) {
      header.addEventListener('mousedown', handleMouseDown);
      header.addEventListener('touchstart', handleTouchStart);
    }
    if (resizeHandle) {
      resizeHandle.addEventListener('mousedown', handleResizeMouseDown);
      resizeHandle.addEventListener('touchstart', handleResizeTouchStart, { passive: false });
    }

    return () => {
      if (header) {
        header.removeEventListener('mousedown', handleMouseDown);
        header.removeEventListener('touchstart', handleTouchStart);
      }
      if (resizeHandle) {
        resizeHandle.removeEventListener('mousedown', handleResizeMouseDown);
        resizeHandle.removeEventListener('touchstart', handleResizeTouchStart);
      }
    };
  }, [isOpen, position.x, position.y, size.width, size.height]);


  if (!isOpen) return null;

  return (
    <div
      ref={windowRef}
      className="fixed z-50 bg-background rounded-lg shadow-2xl flex flex-col border"
      style={{
        left: position.x,
        top: position.y,
        width: size.width,
        height: size.height,
        touchAction: 'none'
      }}
    >
      <div
        ref={headerRef}
        className="flex items-center justify-between p-2 bg-secondary rounded-t-lg cursor-grab active:cursor-grabbing border-b"
      >
        <h3 className="font-semibold text-sm pl-2 select-none">{title}</h3>
        <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onClose}>
          <X className="h-4 w-4" />
        </Button>
      </div>
      <div className="flex-1 p-2 overflow-auto relative">
        {children}
      </div>
      <div
        ref={resizeHandleRef}
        className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize"
        style={{
          clipPath: 'polygon(100% 0, 0 100%, 100% 100%)',
          backgroundColor: 'hsl(var(--muted-foreground))',
          opacity: 0.5
        }}
      />
    </div>
  );
}
