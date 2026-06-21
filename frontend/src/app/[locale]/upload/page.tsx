'use client';

import { Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { Footer } from '@/components/layout/footer';
import { UploadForm } from '@/components/upload/upload-form';
import { useUploadWorkflow } from '@/hooks/upload/use-upload-workflow';

function UploadPageContent() {
  const t = useTranslations('upload');
  const workflow = useUploadWorkflow();

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
          <UploadForm
            files={workflow.files}
            scoreName={workflow.scoreName}
            difficulty={workflow.difficulty}
            isProcessing={workflow.isProcessing}
            isUploading={workflow.isUploading}
            isSubmitting={workflow.isSubmitting}
            taskProgress={workflow.taskProgress}
            taskError={workflow.taskError}
            taskErrorMessage={workflow.taskErrorMessage}
            onFilesAdded={workflow.appendFiles}
            onClearFiles={workflow.clearFiles}
            onRemoveFile={workflow.removeFile}
            onScoreNameChange={workflow.setScoreName}
            onDifficultyChange={workflow.setDifficulty}
            onSubmit={workflow.startRecognition}
          />
        </div>
      </main>
      <Footer />
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
