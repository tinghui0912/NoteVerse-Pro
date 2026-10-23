// @vitest-environment jsdom

import type { ComponentProps } from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { UploadForm } from './upload-form';
import common from '@/../messages/en/common.json';
import scoreStyles from '@/../messages/en/scoreStyles.json';
import upload from '@/../messages/en/upload.json';

function renderForm(overrides: Partial<ComponentProps<typeof UploadForm>> = {}) {
  const props: ComponentProps<typeof UploadForm> = {
    files: [],
    scoreName: '',
    taxonomyTags: [],
    isProcessing: false,
    isUploading: false,
    isSubmitting: false,
    taskProgress: 0,
    taskError: null,
    taskErrorMessage: '',
    onFilesAdded: vi.fn(),
    onClearFiles: vi.fn(),
    onRemoveFile: vi.fn(),
    onScoreNameChange: vi.fn(),
    onTaxonomyTagsChange: vi.fn(),
    onSubmit: vi.fn(),
    ...overrides,
  };
  const view = render(
    <NextIntlClientProvider locale="en" messages={{ common, scoreStyles, upload }}>
      <UploadForm {...props} />
    </NextIntlClientProvider>
  );
  const input = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
  return { ...view, props, input, dropzone: input.parentElement! };
}

function transfer(files: File[]) {
  return {
    files,
    items: files.map((file) => ({ kind: 'file', type: file.type, getAsFile: () => file })),
    types: ['Files'],
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('UploadForm with real react-dropzone', () => {
  it('passes a dropped PNG to the application as a browser File exactly once', async () => {
    const { props, dropzone } = renderForm();
    const file = new File(['score'], 'score.png', { type: 'image/png' });

    await act(async () => fireEvent.drop(dropzone, { dataTransfer: transfer([file]) }));

    await waitFor(() => expect(props.onFilesAdded).toHaveBeenCalledTimes(1));
    const accepted: File[] = vi.mocked(props.onFilesAdded).mock.calls[0][0];
    expect(accepted).toEqual([file]);
    expect(accepted[0]).toBeInstanceOf(File);
    expect(accepted[0]).toBe(file);
  });

  it('keeps PNG/JPG/JPEG/BMP selection while rejecting other image extensions and non-images', async () => {
    const { props, input } = renderForm();
    const accepted = [
      new File(['png'], 'score.png', { type: 'image/png' }),
      new File(['jpg'], 'score.jpg', { type: 'image/jpeg' }),
      new File(['jpeg'], 'score.jpeg', { type: 'image/jpeg' }),
      new File(['bmp'], 'score.bmp', { type: 'image/bmp' }),
    ];
    const rejected = [
      new File(['gif'], 'score.gif', { type: 'image/gif' }),
      new File(['webp'], 'score.webp', { type: 'image/webp' }),
      new File(['svg'], 'score.svg', { type: 'image/svg+xml' }),
      new File(['text'], 'score.txt', { type: 'text/plain' }),
    ];

    await act(async () => fireEvent.change(input, { target: { files: [...accepted, ...rejected] } }));

    await waitFor(() => expect(props.onFilesAdded).toHaveBeenCalledTimes(1));
    expect(vi.mocked(props.onFilesAdded).mock.calls[0][0]).toEqual(accepted);
    expect(input.accept.split(',')).toEqual(['.png', '.jpg', '.jpeg', '.bmp']);
  });

  it('does not add an image pasted into the focused dropzone', async () => {
    const { props, dropzone } = renderForm();
    const file = new File(['score'], 'pasted.png', { type: 'image/png' });
    // noKeyboard intentionally leaves the root out of tab navigation; focus it for this event.
    dropzone.tabIndex = -1;
    dropzone.focus();
    expect(dropzone).toHaveFocus();

    await act(async () => fireEvent.paste(dropzone, { clipboardData: transfer([file]) }));

    expect(props.onFilesAdded).not.toHaveBeenCalled();
  });

  it('opens the empty dropzone file input once on click and keeps keyboard activation disabled', () => {
    const { props, input, dropzone } = renderForm();
    const click = vi.spyOn(input, 'click');

    fireEvent.keyDown(dropzone, { key: 'Enter', keyCode: 13 });
    fireEvent.keyDown(dropzone, { key: ' ', keyCode: 32 });
    expect(click).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(upload.dropzoneText));

    expect(click).toHaveBeenCalledTimes(1);
    expect(props.onFilesAdded).not.toHaveBeenCalled();
  });

  it('opens Add Images once and delivers its selection without a duplicate callback', async () => {
    const existing = new File(['old'], 'old.png', { type: 'image/png' });
    const { props, input } = renderForm({
      files: [{ file: existing, preview: 'data:image/png;base64,aA==', status: 'pending' }],
    });
    const click = vi.spyOn(input, 'click');
    fireEvent.click(screen.getByRole('button', { name: upload.addMoreImages }));
    expect(click).toHaveBeenCalledTimes(1);
    expect(props.onClearFiles).not.toHaveBeenCalled();

    const added = new File(['new'], 'new.png', { type: 'image/png' });
    await act(async () => fireEvent.change(input, { target: { files: [added] } }));
    await waitFor(() => expect(props.onFilesAdded).toHaveBeenCalledTimes(1));
    expect(vi.mocked(props.onFilesAdded).mock.calls[0][0]).toEqual([added]);
  });

  it('waits for reselect confirmation, then clears files and opens one dialog', async () => {
    const file = new File(['score'], 'score.png', { type: 'image/png' });
    const { props, input } = renderForm({
      files: [{ file, preview: 'data:image/png;base64,aA==', status: 'pending' }],
    });
    const click = vi.spyOn(input, 'click');

    fireEvent.click(screen.getByText(upload.dropzoneText));
    expect(await screen.findByRole('alertdialog')).toBeVisible();
    expect(click).not.toHaveBeenCalled();
    expect(props.onClearFiles).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: common.confirm }));

    expect(props.onClearFiles).toHaveBeenCalledTimes(1);
    expect(click).toHaveBeenCalledTimes(1);
    expect(props.onFilesAdded).not.toHaveBeenCalled();
  });
});
