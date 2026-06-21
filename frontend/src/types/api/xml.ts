export interface InitSessionResponse {
  session_id?: string;
  task_id: string;
}

export interface PreviewResponse {
  preview_url: string;
}

export interface SaveResponse {
  storage_key: string;
  size_bytes: number;
  image_count?: number;
}

export interface SaveAndRenderResponse {
  task_id: string;
  final_xml: string;
  final_images: Array<{
    page: number;
    storage_key: string;
  }>;
  image_count: number;
}

export interface FingeringResponse {
  file_id: number;
  filename: string;
  size: number;
  hand: string;
  depth: number;
  download_url: string;
}
