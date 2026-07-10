'use client';

import { Suspense } from 'react';
import { useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { PageHeader } from '@/components/page/page-header';
import { UploadForm } from '@/components/upload/upload-form';
import { useUploadWorkflow } from '@/hooks/upload/use-upload-workflow';

function UploadPageContent() {
  const t = useTranslations('upload');
  const workflow = useUploadWorkflow();

  return (
    <div className="mx-auto max-w-4xl px-4 py-8 sm:px-6 lg:px-8">
      <PageHeader title={t('title')} description={t('subtitle')} />
      <UploadForm
        files={workflow.files}
        scoreName={workflow.scoreName}
        taxonomyTags={workflow.taxonomyTags}
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
        onTaxonomyTagsChange={workflow.setTaxonomyTags}
        onSubmit={workflow.startRecognition}
      />
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
