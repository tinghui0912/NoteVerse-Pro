'use client';

import { useTranslations } from 'next-intl';
import { useBackendMessage } from '@/hooks/use-backend-message';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { UploadCloud, XCircle, PlusSquare, X, Loader2 } from 'lucide-react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useState, useEffect, useRef, Suspense } from 'react';
import { useDropzone } from 'react-dropzone';
import Image from 'next/image';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog"
import { cn } from '@/lib/utils';
import { Footer } from '@/components/layout/footer';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from '@/components/ui/dialog';
import { Carousel, CarouselContent, CarouselItem, CarouselNext, CarouselPrevious, type CarouselApi } from '@/components/ui/carousel';
import { filesApi, tasksApi } from '@/lib/api';
import { useSubmitBatch, useTaskDetail } from '@/hooks/queries/use-task-queries';
import type { UploadedFile } from '@/types/api';
import { ApiError } from '@/lib/api-client';
import { fetchAuthenticatedImage } from '@/lib/utils/image';
import { useToast } from '@/hooks/use-toast';

// 扩展 File 类型以包含预览和上传状态
interface UploadableFile {
  file: File;
  preview: string;
  fileId?: string; // 上传后的文件 ID (SHA256)
  sha256?: string; // 历史任务的文件哈希（可复用）
  status: 'pending' | 'uploading' | 'uploaded' | 'error';
  error?: string;
}

function UploadPageContent() {
  const t = useTranslations('upload');
  const tCommon = useTranslations('common');
  const tb = useBackendMessage();
  const router = useRouter();
  const { toast } = useToast();

  const [files, setFiles] = useState<UploadableFile[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [modalStartIndex, setModalStartIndex] = useState(0);
  const [carouselApi, setCarouselApi] = useState<CarouselApi>()
  const [currentSlide, setCurrentSlide] = useState(0);
  const [isUploading, setIsUploading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // 跟踪组件是否挂载，用于停止轮询
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const [scoreName, setScoreName] = useState('');
  const [difficulty, setDifficulty] = useState('difficultyIntermediate');
  // 任务轮询状态
  const [currentTaskId, setCurrentTaskId] = useState<string | null>(null);
  const [taskProgress, setTaskProgress] = useState(0);
  const [taskStatus, setTaskStatus] = useState('');
  const [taskError, setTaskError] = useState<string | null>(null); // 任务错误信息
  const [pollInterval, setPollInterval] = useState<number | false>(false);
  const [pollStartTime, setPollStartTime] = useState<number>(0);

  const { data: statusResponse } = useTaskDetail(currentTaskId || '', {
    enabled: !!currentTaskId && pollInterval !== false,
    refetchInterval: pollInterval
  });
  const submitBatchMutation = useSubmitBatch();

  // 轮询状态监听
  useEffect(() => {
    if (!statusResponse?.data || !currentTaskId) return;

    // 检查超时 (5分钟)
    if (Date.now() - pollStartTime > 150 * 2000) {
      toast({
        title: t('processingTimeout'),
        description: t('processingTimeoutDesc'),
        variant: 'destructive',
      });
      setIsSubmitting(false);
      setCurrentTaskId(null);
      setPollInterval(false);
      return;
    }

    const data = statusResponse.data;
    setTaskProgress(data.progress || 0);
    setTaskStatus(data.current_step || 'processing');

    const state = String(data.state).toUpperCase();

    if (state === 'PENDING_REVIEW' || state === 'SUCCESS') {
      setIsSubmitting(false);
      setCurrentTaskId(null);
      setPollInterval(false);
      setTaskProgress(0);
      setTaskStatus('');

      files.forEach(f => URL.revokeObjectURL(f.preview));
      setFiles([]);

      const redirectPath = state === 'PENDING_REVIEW' ? `/review/${currentTaskId}` : `/results/${currentTaskId}`;
      router.push(redirectPath);
    } else if (state === 'FAILURE') {
      setTaskError(data.error || t('taskProcessingFailed'));
      setIsSubmitting(false);
      setCurrentTaskId(null);
      setPollInterval(false);
    }
  }, [statusResponse?.data, currentTaskId, files, router, t, pollStartTime, toast]);

  // URL 参数
  const searchParams = useSearchParams();
  const urlTaskId = searchParams.get('task_id');
  const hasRestoredRef = useRef(false); // 防止重复恢复

  const onDrop = useCallback((acceptedFiles: File[]) => {
    const newFiles: UploadableFile[] = acceptedFiles.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      status: 'pending',
    }));
    setFiles(prevFiles => [...prevFiles, ...newFiles]);
  }, []);

  const handleReselect = (openFileDialog: () => void) => {
    files.forEach(f => URL.revokeObjectURL(f.preview));
    setFiles([]);
    openFileDialog();
  };

  const { getRootProps, getInputProps, isDragActive, open } = useDropzone({
    onDrop,
    accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.bmp'] },
    noClick: files.length > 0, // 有文件时禁用点击（使用 AlertDialog），无文件时启用点击
    noKeyboard: true,
  });

  const removeFile = (e: React.MouseEvent, index: number) => {
    e.stopPropagation();
    setFiles(prevFiles => {
      const newFiles = [...prevFiles];
      const removedFile = newFiles.splice(index, 1);
      if (removedFile[0]) {
        URL.revokeObjectURL(removedFile[0].preview);
      }
      return newFiles;
    });
  };

  /**
   * 上传文件并提交任务
   */
  const handleRecognition = async () => {
    if (files.length === 0) return;

    // 重置之前的任务状态
    setCurrentTaskId(null);
    setTaskProgress(0);
    setTaskStatus('');
    setTaskError(null); // 清除错误状态

    setIsUploading(true);

    try {
      // 第一步：上传所有文件（有 uploadId 的直接复用，没有的需要上传）
      const uploadedFileIds: string[] = [];

      for (let i = 0; i < files.length; i++) {
        const currentFile = files[i];

        // 有 sha256 的文件可以直接复用
        if (currentFile.sha256) {
          uploadedFileIds.push(currentFile.sha256);
          continue;
        }

        // 已经上传过的文件（本次会话上传的）
        if (currentFile.status === 'uploaded' && currentFile.fileId) {
          uploadedFileIds.push(currentFile.fileId);
          continue;
        }

        // 更新状态为 uploading
        setFiles(prev => prev.map((f, idx) =>
          idx === i ? { ...f, status: 'uploading' as const } : f
        ));

        try {
          const response = await filesApi.uploadFile(currentFile.file);
          if (response.data?.file_id) {
            uploadedFileIds.push(response.data.file_id);

            // 更新状态为 uploaded
            setFiles(prev => prev.map((f, idx) =>
              idx === i ? { ...f, status: 'uploaded' as const, fileId: response.data?.file_id } : f
            ));
          }
        } catch (err) {
          // 更新状态为 error
          const errorMessage = err instanceof ApiError ? err.message : tCommon('operationFailed');
          setFiles(prev => prev.map((f, idx) =>
            idx === i ? { ...f, status: 'error' as const, error: errorMessage } : f
          ));
          throw new Error(t('uploadFailedFile', { name: '{name}' }).replace('{name}', currentFile.file.name));
        }
      }

      setIsUploading(false);
      setIsSubmitting(true);

      // 第二步：提交处理任务
      const response = await submitBatchMutation.mutateAsync({
        fileIds: uploadedFileIds,
        options: {
          title: scoreName || undefined,
          difficulty,
        }
      });

      if (response.data?.task_id) {
        const taskId = response.data.task_id;
        setCurrentTaskId(taskId);
        setTaskStatus(t('taskStarted'));
        setTaskProgress(5);
        setPollStartTime(Date.now());
        setPollInterval(2000);
      }
    } catch (err) {
      const errorMessage = err instanceof ApiError ? err.message : (err as Error).message || t('processingFailed');
      toast({
        title: t('submitFailed'),
        description: errorMessage,
        variant: 'destructive',
      });
      setIsUploading(false);
      setIsSubmitting(false);
    }
  };

  const handleOpenModal = (index: number) => {
    setModalStartIndex(index);
    setIsModalOpen(true);
  }

  useEffect(() => {
    if (!carouselApi) {
      return
    }
    setCurrentSlide(carouselApi.selectedScrollSnap())
    carouselApi.on("select", () => {
      setCurrentSlide(carouselApi.selectedScrollSnap())
    })
  }, [carouselApi])

  // 从 URL 参数恢复任务状态
  useEffect(() => {
    if (!urlTaskId || hasRestoredRef.current) return;
    hasRestoredRef.current = true;

    // 恢复任务状态
    const restoreTask = async () => {
      try {
        const response = await tasksApi.getTaskDetails(urlTaskId);
        const data = response.data;

        if (!data) return;

        const state = String(data.state).toUpperCase();

        // 恢复乐谱名称和难度
        if (data.title) {
          setScoreName(data.title);
        }
        if (data.difficulty) {
          setDifficulty(data.difficulty);
        }

        // 恢复原始图片（使用 upload_ids 返回的数据）
        const originalImages = data.files?.original_image;
        const uploadIds = (data as any).upload_ids || [];

        if (originalImages && originalImages.length > 0) {
          const restoredFiles: UploadableFile[] = [];

          for (let i = 0; i < originalImages.length; i++) {
            const imgUrl = await fetchAuthenticatedImage(urlTaskId, 'original_image', i + 1);
            if (imgUrl) {
              // 从 upload_ids 中获取对应的 upload_id
              const uploadInfo = uploadIds[i];
              const fileName = uploadInfo?.original_filename || originalImages[i].path?.split('/').pop() || `image_${i + 1}.png`;

              restoredFiles.push({
                file: new File([], fileName, { type: 'image/png' }),
                preview: imgUrl,
                status: 'uploaded', // 标记为已上传（因为有 sha256 可复用）
                sha256: uploadInfo?.sha256, // 保存 sha256 用于复用
                fileId: undefined,
              });
            }
          }

          if (restoredFiles.length > 0) {
            setFiles(restoredFiles);
          }
        }

        if (state === 'PENDING' || state === 'PROGRESS') {
          // 处理中，恢复轮询
          setCurrentTaskId(urlTaskId);
          setIsSubmitting(true);
          setTaskProgress(data.progress || 0);
          setTaskStatus(data.current_step || 'processing');
          setPollStartTime(Date.now());
          setPollInterval(2000);
        } else if (state === 'FAILURE') {
          // 失败，显示错误信息
          setCurrentTaskId(urlTaskId);
          setTaskError(data.error || t('processingFailed'));
          setTaskProgress(0);
          setTaskStatus(t('processingFailedStatus'));
        }
        // SUCCESS 状态不处理，让用户重新上传
      } catch (err) {
        console.error('恢复任务状态失败:', err);
      }
    };

    restoreTask();
  }, [urlTaskId]);


  useEffect(() => {
    return () => {
      if (files.length > 0) {
        files.forEach(f => URL.revokeObjectURL(f.preview));
      }
    };
  }, []);

  const isProcessing = isUploading || isSubmitting;

  const previews = files.map((f, index) => (
    <div
      key={f.file.name + index}
      className="relative h-32 w-32 rounded-lg border-2 border-muted overflow-hidden group shadow-md cursor-pointer"
      onClick={() => handleOpenModal(index)}
    >
      <Image
        src={f.preview}
        alt={f.file.name}
        fill
        className="object-cover transition-transform duration-300 group-hover:scale-110"
      />
      {/* 状态指示器 */}
      {f.status === 'uploading' && (
        <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
          <Loader2 className="h-6 w-6 text-white animate-spin" />
        </div>
      )}
      {f.status === 'uploaded' && (
        <div className="absolute top-1 left-1 bg-green-500 text-white text-xs px-1 rounded">
          ✓
        </div>
      )}
      {f.status === 'error' && (
        <div className="absolute inset-0 bg-red-500/50 flex items-center justify-center">
          <XCircle className="h-6 w-6 text-white" />
        </div>
      )}
      <Button
        variant="destructive"
        size="icon"
        className="absolute top-1 right-1 h-6 w-6 rounded-full opacity-0 group-hover:opacity-100 transition-opacity z-10"
        onClick={(e) => removeFile(e, index)}
        disabled={isProcessing}
      >
        <XCircle className="h-4 w-4" />
      </Button>
    </div>
  ));

  const DropzoneContent = () => (
    <div className="flex flex-col items-center justify-center text-center h-64 p-4">
      <UploadCloud className="mb-4 h-12 w-12 text-muted-foreground" />
      <p className="text-lg font-semibold text-gray-800">{t('dropzoneText')}</p>
      <p className="text-sm text-muted-foreground">{t('dropzoneHint')}</p>
    </div>
  );

  return (
    <div className="bg-gray-50 min-h-screen flex flex-col">
      <div className="bg-gray-900">
        <div className="pt-32 pb-16 max-w-7xl mx-auto px-4 text-center">
          <h1 className="text-4xl sm:text-6xl font-bold text-white mb-4">{t('title')}</h1>
          <p className="text-lg text-gray-300">{t('subtitle')}</p>
        </div>
      </div>

      <main className="flex-grow">
        <div className="max-w-4xl mx-auto px-4 py-16">
          <Card className="w-full bg-white p-8 rounded-2xl shadow-lg">
            <CardContent className="space-y-6 p-0">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-left">
                <div className="space-y-2">
                  <Label htmlFor="score-name">{t('scoreNameLabel')}</Label>
                  <Input
                    id="score-name"
                    placeholder={t('scoreNamePlaceholder')}
                    className="h-12 bg-white"
                    value={scoreName}
                    onChange={(e) => setScoreName(e.target.value)}
                    disabled={isProcessing}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="score-difficulty">{t('difficultyLabel')}</Label>
                  <Select value={difficulty} onValueChange={setDifficulty} disabled={isProcessing}>
                    <SelectTrigger id="score-difficulty" className="h-12 bg-white">
                      <SelectValue placeholder={t('difficultyLabel')} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="difficultyBeginner">{t('difficultyBeginner')}</SelectItem>
                      <SelectItem value="difficultyIntermediate">{t('difficultyIntermediate')}</SelectItem>
                      <SelectItem value="difficultyAdvanced">{t('difficultyAdvanced')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div
                {...getRootProps({
                  onDragOver: (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  },
                  onDragEnter: (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                  },
                })}
                className={cn(
                  'rounded-2xl border-2 border-dashed p-4 transition-colors cursor-pointer bg-gray-50',
                  isDragActive ? 'border-primary bg-orange-50' : 'border-gray-200 hover:border-gray-300',
                  isProcessing && 'pointer-events-none opacity-50'
                )}
              >
                <input {...getInputProps()} />
                {files.length > 0 ? (
                  <AlertDialog>
                    <AlertDialogTrigger asChild>
                      <div>
                        <DropzoneContent />
                      </div>
                    </AlertDialogTrigger>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>{t('reselectConfirmTitle')}</AlertDialogTitle>
                        <AlertDialogDescription>
                          {t('reselectConfirmDesc')}
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>{tCommon('cancel')}</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleReselect(open)}>
                          {tCommon('confirm')}
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                ) : (
                  <DropzoneContent />
                )}
              </div>

              {files.length > 0 && (
                <div className="space-y-4 text-left">
                  <h3 className="font-semibold text-gray-800">{t('selectedImages')} ({files.length})</h3>
                  <div className="flex flex-wrap gap-4">
                    {previews}
                    <button
                      onClick={open}
                      disabled={isProcessing}
                      className="h-32 w-32 rounded-lg border-2 border-dashed border-gray-300 flex flex-col items-center justify-center text-muted-foreground hover:bg-gray-100 hover:text-foreground transition-colors disabled:opacity-50"
                    >
                      <PlusSquare className="h-8 w-8 mb-2" />
                      <span>{t('addMoreImages')}</span>
                    </button>
                  </div>
                </div>
              )}
              {/* 任务错误信息显示 */}
              {taskError && (
                <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-center">
                  <div className="flex items-center justify-center gap-2 text-red-600 font-medium mb-2">
                    <XCircle className="h-5 w-5" />
                    {t('processingFailed')}
                  </div>
                  <p className="text-sm text-red-500">{t(taskError) || taskError}</p>
                </div>
              )}



              <div className='text-center space-y-4'>
                <Button
                  onClick={handleRecognition}
                  size="lg"
                  className="w-full max-w-xs bg-orange-500 hover:bg-orange-600 text-white font-semibold"
                  disabled={files.length === 0 || isProcessing}
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t('uploading')}
                    </>
                  ) : isSubmitting ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {t('processingProgress', { progress: '{progress}' }).replace('{progress}', String(taskProgress))}
                    </>
                  ) : (
                    t('startRecognition')
                  )}
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      </main>
      <Footer />

      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="w-[90vw] max-w-5xl flex flex-col p-2 sm:p-4">
          <DialogHeader className="flex-row items-center justify-between space-y-0 p-2 sm:pb-2">
            <DialogTitle className="truncate text-sm sm:text-base">{files[currentSlide]?.file.name}</DialogTitle>
            <DialogClose className="relative rounded-sm opacity-70 ring-offset-background transition-opacity hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none data-[state=open]:bg-accent data-[state=open]:text-muted-foreground">
              <X className="h-4 w-4" />
              <span className="sr-only">Close</span>
            </DialogClose>
          </DialogHeader>
          <Carousel setApi={setCarouselApi} opts={{ startIndex: modalStartIndex, loop: true }} className="w-full relative">
            <CarouselContent>
              {files.map((f, index) => (
                <CarouselItem key={index}>
                  <div className="relative w-full h-[80vh]">
                    <Image
                      src={f.preview}
                      alt={f.file.name}
                      fill
                      className="object-contain rounded-md"
                    />
                  </div>
                </CarouselItem>
              ))}
            </CarouselContent>
            <CarouselPrevious className="left-2" />
            <CarouselNext className="right-2" />
          </Carousel>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function UploadPage() {
  return (
    <Suspense fallback={<div className="min-h-screen flex items-center justify-center"><Loader2 className="h-8 w-8 animate-spin text-orange-500" /></div>}>
      <UploadPageContent />
    </Suspense>
  );
}
