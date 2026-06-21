export interface UploadedFile {
  file_id: string;
  filename: string;
  storage_key: string;
  size: number;
}

export interface TaskFiles {
  preview_image?: FileInfo[];
  enhanced_xml?: FileInfo[];
  current_xml?: FileInfo[];
  final_xml?: FileInfo[];
  final_image?: FileInfo[];
}

export interface FileInfo {
  storage_key: string;
  filename: string;
  page_number?: number;
  size?: number;
  mime_type?: string;
}

export interface FileAccessUrl {
  url: string;
  filename: string;
  mime_type: string;
  expires_in?: number | null;
}
