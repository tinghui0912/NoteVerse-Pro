'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useScoreData } from '@/contexts/editor-provider';
import { useTaskDetail } from '@/hooks/queries/use-task-queries';
import { useXmlContent } from '@/hooks/queries/use-xml-queries';
import { fetchAuthenticatedImage } from '@/lib/utils/image';

export function useResultsResources(taskId: string) {
  const { setRawXml, setScoreData } = useScoreData();
  const taskQuery = useTaskDetail(taskId);
  const task = taskQuery.data?.data;
  const xmlQuery = useXmlContent(taskId, 'final', { enabled: Boolean(task) });
  const [parsedTitle, setParsedTitle] = useState('');
  const [imageUrls, setImageUrls] = useState<string[]>([]);
  const [imagesLoading, setImagesLoading] = useState(false);
  const ownedObjectUrlsRef = useRef(new Set<string>());
  const finalImages = useMemo(() => task?.files?.final_image ?? [], [task?.files?.final_image]);
  const imageSignature = useMemo(
    () => finalImages.map((image) => image.storage_key).join('|'),
    [finalImages]
  );

  useEffect(() => {
    const xmlContent = xmlQuery.data;
    if (!xmlContent) return;
    let cancelled = false;
    setRawXml(xmlContent);

    void import('@/lib/musicxml/parser').then(({ MusicXMLParser }) => {
      if (cancelled) return;
      try {
        const data = new MusicXMLParser(xmlContent).parse();
        setScoreData(data);
        setParsedTitle(data.mainTitle ?? '');
      } catch (error) {
        console.error('Failed to parse XML', error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [setRawXml, setScoreData, xmlQuery.data]);

  useEffect(() => {
    const controller = new AbortController();
    const ownedObjectUrls = ownedObjectUrlsRef.current;
    let loadedUrls: string[] = [];

    void Promise.resolve().then(async () => {
      if (controller.signal.aborted) return;
      setImagesLoading(finalImages.length > 0);
      setImageUrls([]);
      const urls = await Promise.all(
        finalImages.map((_, index) =>
          fetchAuthenticatedImage(taskId, 'final_image', index + 1, undefined, undefined, controller.signal)
        )
      );
      if (controller.signal.aborted) return;
      loadedUrls = urls.filter((url): url is string => Boolean(url));
      loadedUrls.forEach((url) => {
        if (url.startsWith('blob:')) ownedObjectUrls.add(url);
      });
      setImageUrls(loadedUrls);
      setImagesLoading(false);
    });

    return () => {
      controller.abort();
      loadedUrls.forEach((url) => {
        if (url.startsWith('blob:')) {
          URL.revokeObjectURL(url);
          ownedObjectUrls.delete(url);
        }
      });
    };
  }, [finalImages, imageSignature, taskId]);

  useEffect(
    () => {
      const ownedObjectUrls = ownedObjectUrlsRef.current;
      return () => {
        ownedObjectUrls.forEach((url) => URL.revokeObjectURL(url));
        ownedObjectUrls.clear();
      };
    },
    []
  );

  return {
    imageUrls,
    imagesLoading,
    parsedTitle,
    rawXml: xmlQuery.data ?? '',
    task,
    taskError: taskQuery.error,
    taskLoading: taskQuery.isLoading,
  };
}
