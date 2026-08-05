import data from './placeholder-images.json';

export type ImagePlaceholder = {
  id: string;
  description: string;
  url: string;
  hint: string;
};

const imageList: { id: string; description: string; imageUrl: string; imageHint: string }[] = data.placeholderImages;

export const placeholderImages = imageList.reduce((acc, item) => {
  acc[item.id] = {
    id: item.id,
    description: item.description,
    url: item.imageUrl,
    hint: item.imageHint
  };
  return acc;
}, {} as Record<string, ImagePlaceholder>);
