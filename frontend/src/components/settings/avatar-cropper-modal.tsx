'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Cropper, { type Area } from 'react-easy-crop';
import { X } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { getCroppedAvatarFile } from '@/components/settings/crop-image';

const MIN_ZOOM = 1;
const MAX_ZOOM = 3;

export function AvatarCropperModal({
  isOpen,
  onClose,
  imageSrc,
  onSave,
}: {
  isOpen: boolean;
  onClose: () => void;
  imageSrc: string;
  onSave: (image: File) => void;
}) {
  const t = useTranslations('common');
  const tSettings = useTranslations('settings');
  const [crop, setCrop] = useState({ x: 0, y: 0 });
  const [zoom, setZoom] = useState(1);
  const [croppedAreaPixels, setCroppedAreaPixels] = useState<Area | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  const handleCropComplete = useCallback((_: Area, croppedArea: Area) => {
    setCroppedAreaPixels(croppedArea);
  }, []);

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    setCrop({ x: 0, y: 0 });
    setZoom(1);
    setCroppedAreaPixels(null);
  }, [imageSrc, isOpen]);

  const handleSave = async () => {
    if (!croppedAreaPixels || isSaving) {
      return;
    }

    setIsSaving(true);

    try {
      const file = await getCroppedAvatarFile(imageSrc, croppedAreaPixels);
      onSave(file);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-3xl gap-0 overflow-hidden p-0 data-[state=closed]:zoom-out-100 data-[state=open]:zoom-in-100">
        <DialogHeader className="border-b p-4">
          <DialogTitle>{tSettings('cropAvatar')}</DialogTitle>
          <DialogClose className="absolute right-4 top-4 rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
            <X className="h-4 w-4" />
            <span className="sr-only">Close</span>
          </DialogClose>
        </DialogHeader>

        <div className="space-y-4 p-4">
          <div className="relative h-[56vh] min-h-[320px] max-h-[560px] overflow-hidden rounded-md bg-gray-950">
            <Cropper
              image={imageSrc}
              crop={crop}
              zoom={zoom}
              aspect={1}
              cropShape="round"
              showGrid={false}
              minZoom={MIN_ZOOM}
              maxZoom={MAX_ZOOM}
              onCropChange={setCrop}
              onZoomChange={setZoom}
              onCropComplete={handleCropComplete}
            />
          </div>
        </div>

        <DialogFooter className="border-t bg-gray-50/80 p-4">
          <Button variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button onClick={handleSave} disabled={!croppedAreaPixels || isSaving}>
            {tSettings('saveAvatar')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
