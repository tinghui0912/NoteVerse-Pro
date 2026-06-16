"""
MuseScore rendering engine.
Wraps MuseScore 4 CLI for rendering MusicXML to images.
"""
import os
import subprocess
from pathlib import Path
from typing import Optional, TypedDict
from celery.utils.log import get_task_logger
from app.core.config import settings

logger = get_task_logger(__name__)


class MuseScoreSuccessResult(TypedDict):
    """Successful MuseScore rendering result."""

    success: bool
    output_path: str
    format: str
    dpi: int | None


class MuseScoreFailureResult(TypedDict, total=False):
    """Failed MuseScore rendering result."""

    success: bool
    error: str
    code: str
    returncode: int
    error_type: str


MuseScoreRenderResult = MuseScoreSuccessResult | MuseScoreFailureResult


class MuseScoreEngine:
    """MuseScore 4 rendering engine."""
    
    def __init__(
        self,
        musescore_path: Optional[str] = None,
        output_folder: Optional[str] = None,
        timeout_seconds: Optional[int] = None,
    ):
        """
        Initialize MuseScore engine.
        
        Args:
            musescore_path: Path to MuseScore executable.
                           Defaults to settings.MUSESCORE_PATH
            output_folder: Output directory for rendered files.
                          Defaults to settings.WORK_ROOT
        """
        self.musescore_path = musescore_path or settings.MUSESCORE_PATH
        self.output_folder = output_folder or settings.WORK_ROOT
        self.timeout_seconds = timeout_seconds
        
        if not self.musescore_path:
            raise ValueError("MUSESCORE_PATH not configured in settings")
    
    def render_to_image(
        self,
        xml_path: str,
        output_name: Optional[str] = None,
        format: str = 'png',
        dpi: Optional[int] = None
    ) -> MuseScoreRenderResult:
        """
        Render MusicXML to image.
        
        Args:
            xml_path: Input MusicXML file path
            output_name: Output filename (without extension)
            format: Output format ('png', 'pdf', 'svg')
            dpi: Optional output resolution. When omitted, MuseScore uses its default.
            
        Returns:
            dict: {'success': bool, 'output_path': str, 'error': str (if failed)}
        """
        try:
            abs_xml_path = os.path.abspath(xml_path)
            abs_output_folder = os.path.abspath(self.output_folder)
            
            if not os.path.exists(abs_xml_path):
                raise FileNotFoundError(f"XML file not found: {abs_xml_path}")
            
            if not os.path.exists(self.musescore_path):
                logger.error(f"MuseScore not found: {self.musescore_path}")
                raise FileNotFoundError(f"MuseScore program not found: {self.musescore_path}")
            
            logger.info(f"MuseScore path: {self.musescore_path}")
            
            # Test MuseScore availability
            try:
                logger.info("Checking MuseScore version")
                version_result = subprocess.run(
                    [self.musescore_path, '--version'],
                    capture_output=True,
                    text=True,
                    creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
                )
                
                if version_result.returncode == 0:
                    logger.info(f"MuseScore version: {version_result.stdout.strip()}")
                elif version_result.returncode == 1320:
                    logger.error("MuseScore blocked by Windows security policy")
                else:
                    logger.warning(f"MuseScore version check failed: {version_result.returncode}")
            except Exception as e:
                logger.warning(f"Cannot get MuseScore version: {e}")
            
            # Ensure output directory exists
            os.makedirs(abs_output_folder, exist_ok=True)
            
            # Generate output filename
            if output_name is None:
                output_name = Path(abs_xml_path).stem
            
            output_path = os.path.join(abs_output_folder, f"{output_name}.{format}")
            abs_output_path = os.path.abspath(output_path)
            
            # Build command
            cmd = [
                self.musescore_path,
                '-o', abs_output_path,
                abs_xml_path
            ]
            
            # Add format-specific parameters
            if format == 'png' and dpi is not None:
                cmd.extend(['--image-resolution', str(dpi)])
            elif format == 'pdf' and dpi is not None:
                cmd.extend(['--image-resolution', str(dpi)])
            
            logger.info(f"Executing MuseScore: {' '.join(cmd)}")
            
            # Execute MuseScore
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                cwd=os.getcwd(),
                timeout=self.timeout_seconds,
                creationflags=subprocess.CREATE_NO_WINDOW if os.name == 'nt' else 0
            )
            
            logger.info(f"MuseScore return code: {result.returncode}")
            
            if result.returncode != 0:
                error_msg = result.stderr.strip() if result.stderr.strip() else "Unknown error"
                logger.error(f"MuseScore failed: {error_msg}")
                
                return {
                    'success': False,
                    'error': f'MuseScore execution failed: {error_msg}',
                    'returncode': result.returncode,
                    'code': 'musescore_failed'
                }
            
            # Check if output file was created
            if not os.path.exists(output_path):
                # Try numbered variants (page-1.png, page-2.png, ...)
                base_name = os.path.splitext(output_path)[0]
                extension = os.path.splitext(output_path)[1]
                
                for i in range(1, 10):
                    variant = f"{base_name}-{i}{extension}"
                    if os.path.exists(variant):
                        output_path = variant
                        logger.info(f"Found MuseScore output: {variant}")
                        break
                else:
                    logger.error(f"Output file not generated: {output_path}")
                    return {
                        'success': False,
                        'error': f'Output file not generated: {output_path}',
                        'code': 'preview_render_failed'
                    }
            
            logger.info(f"MuseScore rendering completed: {output_path}")
            
            # Convert to storage-relative path
            from app.utils.paths import to_rel_storage
            rel_output_path = to_rel_storage(output_path)
            
            return {
                'success': True,
                'output_path': rel_output_path,
                'format': format,
                'dpi': dpi
            }
        except subprocess.TimeoutExpired:
            logger.error("MuseScore rendering timed out")
            return {
                'success': False,
                'error': 'MuseScore rendering timed out',
                'code': 'task_timeout',
                'error_type': 'TimeoutExpired',
            }
            
        except Exception as e:
            logger.error(f"MuseScore rendering error: {e}")
            return {
                'success': False,
                'error': str(e),
                'error_type': type(e).__name__,
                'code': 'musescore_failed'
            }
    
    def render_to_pdf(
        self,
        xml_path: str,
        output_name: Optional[str] = None
    ) -> MuseScoreRenderResult:
        """Render MusicXML to PDF format."""
        return self.render_to_image(xml_path, output_name, format='pdf')
    
    def render_to_png(
        self,
        xml_path: str,
        output_name: Optional[str] = None,
        dpi: Optional[int] = None
    ) -> MuseScoreRenderResult:
        """Render MusicXML to PNG format."""
        return self.render_to_image(xml_path, output_name, format='png', dpi=dpi)
    
    def is_available(self) -> bool:
        """Check if MuseScore is available."""
        return os.path.exists(self.musescore_path)
    
    def get_version(self) -> Optional[str]:
        """Get MuseScore version information."""
        try:
            result = subprocess.run(
                [self.musescore_path, '--version'],
                capture_output=True,
                text=True,
                timeout=5
            )
            return result.stdout.strip() if result.returncode == 0 else None
        except Exception:
            return None
