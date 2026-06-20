#!/usr/bin/env python3
"""Render Transcoda KERN outputs through MusicXML and Verovio for visual review.

This script is intentionally standalone. It does not import the NoteVerse app,
touch the database, or call the production processing pipeline.
"""

from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tif", ".tiff"}
KERN_EXTENSIONS = {".krn", ".kern"}


@dataclass
class RenderedCase:
    case_dir: Path
    kern_path: Path
    source_image: Path | None
    mei_path: Path | None = None
    mei_converter_path: Path | None = None
    raw_musicxml_path: Path | None = None
    mei_musicxml_path: Path | None = None
    kern_svg_paths: list[Path] = field(default_factory=list)
    raw_musicxml_svg_paths: list[Path] = field(default_factory=list)
    mei_musicxml_svg_paths: list[Path] = field(default_factory=list)
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)


def _backend_root() -> Path:
    return Path(__file__).resolve().parents[1]


def _build_parser(backend_root: Path) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Convert Transcoda KERN predictions to MusicXML and render SVG review pages with Verovio."
    )
    parser.add_argument(
        "--kern",
        action="append",
        default=[],
        help="KERN/Humdrum file to review. Can be passed multiple times.",
    )
    parser.add_argument(
        "--kern-dir",
        default=None,
        help="Directory of .krn/.kern files to review when --kern is omitted.",
    )
    parser.add_argument(
        "--image",
        action="append",
        default=[],
        help="Optional source image to display beside the corresponding --kern. Can be passed multiple times.",
    )
    parser.add_argument(
        "--image-dir",
        default=None,
        help="Optional directory of source images. Images are matched by stem first, then by sorted order.",
    )
    parser.add_argument(
        "--output-dir",
        default=str(backend_root / "var" / "transcoda-kern-visual-probe"),
        help="Directory for MusicXML, SVG, diagnostics, and HTML outputs.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum number of KERN files to process from --kern-dir.",
    )
    parser.add_argument(
        "--page-width",
        type=int,
        default=2100,
        help="Verovio page width.",
    )
    parser.add_argument(
        "--page-height",
        type=int,
        default=2970,
        help="Verovio page height.",
    )
    parser.add_argument("--scale", type=int, default=35, help="Verovio scale.")
    parser.add_argument(
        "--breaks",
        default="auto",
        help="Verovio page break mode, for example encoded, auto, or smart.",
    )
    parser.add_argument(
        "--stop-on-error",
        action="store_true",
        help="Stop at the first failed case instead of writing an HTML report with errors.",
    )
    return parser


def collect_kern_files(args: argparse.Namespace) -> list[Path]:
    if args.kern:
        paths = [Path(value).expanduser().resolve() for value in args.kern]
    else:
        if not args.kern_dir:
            raise ValueError("Pass --kern or --kern-dir.")
        kern_dir = Path(args.kern_dir).expanduser().resolve()
        paths = sorted(
            path
            for path in kern_dir.iterdir()
            if path.is_file() and path.suffix.lower() in KERN_EXTENSIONS
        )

    if args.limit is not None:
        paths = paths[: args.limit]

    missing = [str(path) for path in paths if not path.exists()]
    if missing:
        raise FileNotFoundError(f"KERN file(s) not found: {', '.join(missing)}")
    if not paths:
        raise FileNotFoundError("No KERN files found.")
    return paths


def collect_images(args: argparse.Namespace, kern_paths: list[Path]) -> dict[Path, Path]:
    explicit_images = [Path(value).expanduser().resolve() for value in args.image]
    if explicit_images:
        missing = [str(path) for path in explicit_images if not path.exists()]
        if missing:
            raise FileNotFoundError(f"Image file(s) not found: {', '.join(missing)}")
        return {
            kern_path: image_path
            for kern_path, image_path in zip(kern_paths, explicit_images, strict=False)
        }

    if not args.image_dir:
        return {}

    image_dir = Path(args.image_dir).expanduser().resolve()
    images = sorted(
        path
        for path in image_dir.iterdir()
        if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
    )
    images_by_stem = {path.stem: path for path in images}
    matched: dict[Path, Path] = {}
    used_images: set[Path] = set()

    for index, kern_path in enumerate(kern_paths):
        by_stem = images_by_stem.get(kern_path.stem)
        if by_stem is not None:
            matched[kern_path] = by_stem
            used_images.add(by_stem)
            continue
        if index < len(images) and images[index] not in used_images:
            matched[kern_path] = images[index]
            used_images.add(images[index])

    return matched


def convert_kern_to_musicxml(
    kern_path: Path,
    musicxml_path: Path,
) -> None:
    command = [
        sys.executable,
        "-m",
        "converter21",
        "-f",
        "humdrum",
        "-t",
        "musicxml",
        str(kern_path),
        str(musicxml_path),
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        stderr_tail = "\n".join(result.stderr.splitlines()[-20:])
        stdout_tail = "\n".join(result.stdout.splitlines()[-20:])
        raise RuntimeError(
            f"converter21 failed to convert KERN to MusicXML (exit {result.returncode}). "
            "Install it with: pip install converter21\n"
            f"stdout:\n{stdout_tail}\n"
            f"stderr:\n{stderr_tail}"
        )
    if not musicxml_path.exists() or musicxml_path.stat().st_size == 0:
        raise RuntimeError("converter21 completed but produced no MusicXML file.")


def convert_mei_to_musicxml(
    mei_path: Path,
    musicxml_path: Path,
) -> None:
    command = [
        sys.executable,
        "-m",
        "converter21",
        "-f",
        "mei",
        "-t",
        "musicxml",
        str(mei_path),
        str(musicxml_path),
    ]
    result = subprocess.run(command, capture_output=True, text=True, check=False)
    if result.returncode != 0:
        stderr_tail = "\n".join(result.stderr.splitlines()[-20:])
        stdout_tail = "\n".join(result.stdout.splitlines()[-20:])
        raise RuntimeError(
            f"converter21 failed to convert MEI to MusicXML (exit {result.returncode}). "
            "Install it with: pip install converter21\n"
            f"stdout:\n{stdout_tail}\n"
            f"stderr:\n{stderr_tail}"
        )
    if not musicxml_path.exists() or musicxml_path.stat().st_size == 0:
        raise RuntimeError("converter21 completed but produced no MusicXML file from MEI.")


def downgrade_verovio_mei_for_converter21(mei_path: Path, downgraded_mei_path: Path) -> None:
    """Rewrite Verovio MEI 6-dev as a minimal MEI 5 document for converter21."""
    mei = mei_path.read_text(encoding="utf-8")
    mei = mei.replace(
        "https://music-encoding.org/schema/dev/mei-all.rng",
        "https://music-encoding.org/schema/5.0/mei-all.rng",
    )
    mei = mei.replace('meiversion="6.0-dev"', 'meiversion="5.0"')
    mei = re.sub(r"\s*<meiHead>.*?</meiHead>", "", mei, count=1, flags=re.DOTALL)
    downgraded_mei_path.write_text(mei, encoding="utf-8")


def convert_kern_to_mei_with_verovio(
    kern_path: Path,
    mei_path: Path,
    page_width: int,
    page_height: int,
    scale: int,
    breaks: str,
) -> None:
    toolkit = _verovio_toolkit("humdrum", page_width, page_height, scale, breaks)
    if not toolkit.loadFile(str(kern_path)):
        log = toolkit.getLog() if hasattr(toolkit, "getLog") else ""
        raise RuntimeError(f"Verovio failed to load {kern_path.name}. {log}".strip())

    mei = toolkit.getMEI()
    if not mei.strip():
        raise RuntimeError("Verovio produced empty MEI.")
    mei_path.write_text(mei, encoding="utf-8")


def _verovio_toolkit(input_from: str, page_width: int, page_height: int, scale: int, breaks: str):
    try:
        import verovio
    except ImportError as exc:
        raise RuntimeError(
            "Python package 'verovio' is required for SVG rendering. "
            "Run this script in the backend Docker container or install verovio."
        ) from exc

    toolkit = verovio.toolkit()
    toolkit.setOptions(
        {
            "inputFrom": input_from,
            "pageWidth": page_width,
            "pageHeight": page_height,
            "scale": scale,
            "adjustPageHeight": True,
            "breaks": breaks,
            "header": "none",
            "footer": "none",
        }
    )
    return toolkit


def render_with_verovio(
    source_path: Path,
    output_dir: Path,
    input_from: str,
    page_width: int,
    page_height: int,
    scale: int,
    breaks: str,
) -> list[Path]:
    toolkit = _verovio_toolkit(input_from, page_width, page_height, scale, breaks)
    if not toolkit.loadFile(str(source_path)):
        log = toolkit.getLog() if hasattr(toolkit, "getLog") else ""
        raise RuntimeError(f"Verovio failed to load {source_path.name}. {log}".strip())

    page_count = int(toolkit.getPageCount())
    if page_count <= 0:
        raise RuntimeError(f"Verovio produced zero pages for {source_path.name}.")

    output_dir.mkdir(parents=True, exist_ok=True)
    svg_paths: list[Path] = []
    for page in range(1, page_count + 1):
        svg = add_white_background(toolkit.renderToSVG(page))
        svg_path = output_dir / f"page-{page:02d}.svg"
        svg_path.write_text(svg, encoding="utf-8")
        svg_paths.append(svg_path)
    return svg_paths


def add_white_background(svg: str) -> str:
    if "<rect data-nv-background" in svg:
        return svg

    svg_start = svg.find("<svg")
    if svg_start < 0:
        return svg

    svg_open_end = svg.find(">", svg_start)
    if svg_open_end < 0:
        return svg

    background = '<rect data-nv-background="true" width="100%" height="100%" fill="white"/>'
    return f"{svg[:svg_open_end + 1]}{background}{svg[svg_open_end + 1:]}"


def safe_slug(path: Path, index: int) -> str:
    slug = re.sub(r"[^A-Za-z0-9._-]+", "-", path.stem).strip("-._")
    if not slug:
        slug = "score"
    return f"{index:03d}-{slug[:48]}"


def copy_source_file(source: Path, target_dir: Path, target_name: str) -> Path:
    target = target_dir / f"{target_name}{source.suffix.lower()}"
    shutil.copy2(source, target)
    return target


def render_svg_items(paths: list[Path], relative_to: Path) -> str:
    if not paths:
        return '<p class="empty">No SVG pages.</p>'
    return "\n".join(
        f'<section class="svg-page"><img src="{html.escape(path.relative_to(relative_to).as_posix())}" alt="{html.escape(path.name)}"></section>'
        for path in paths
    )


def render_case_page(case: RenderedCase) -> None:
    copied_kern = case.case_dir / "prediction.krn"
    kern_text = copied_kern.read_text(encoding="utf-8", errors="replace")
    source_image_html = (
        f'<img src="{html.escape(case.source_image.name)}" alt="Input score image">'
        if case.source_image is not None
        else '<p class="empty">No source image supplied.</p>'
    )
    raw_musicxml_link = (
        f'<a href="{html.escape(case.raw_musicxml_path.name)}" download>raw MusicXML</a>'
        if case.raw_musicxml_path is not None
        else '<span>Raw MusicXML not produced</span>'
    )
    mei_link = (
        f'<a href="{html.escape(case.mei_path.name)}" download>Verovio MEI</a>'
        if case.mei_path is not None
        else '<span>Verovio MEI not produced</span>'
    )
    mei_converter_link = (
        f'<a href="{html.escape(case.mei_converter_path.name)}" download>MEI 5 compatibility copy</a>'
        if case.mei_converter_path is not None
        else '<span>MEI compatibility copy not produced</span>'
    )
    mei_musicxml_link = (
        f'<a href="{html.escape(case.mei_musicxml_path.name)}" download>MEI MusicXML</a>'
        if case.mei_musicxml_path is not None
        else '<span>MEI MusicXML not produced</span>'
    )
    errors = "".join(f"<li>{html.escape(error)}</li>" for error in case.errors)
    warnings = "".join(f"<li>{html.escape(warning)}</li>" for warning in case.warnings)
    status = "FAILED" if case.errors else "OK"

    page = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Transcoda KERN Visual Probe - {html.escape(case.case_dir.name)}</title>
  <style>
    body {{ margin: 0; font-family: system-ui, sans-serif; background: #f6f7f9; color: #172033; }}
    header {{ padding: 16px 20px; background: white; border-bottom: 1px solid #d8dee8; }}
    main {{ display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; padding: 16px; }}
    .panel {{ background: white; border: 1px solid #d8dee8; border-radius: 8px; padding: 12px; overflow: auto; }}
    img {{ max-width: 100%; height: auto; display: block; }}
    .links {{ display: flex; flex-wrap: wrap; gap: 12px; padding: 0 16px 16px; }}
    .links a {{ color: #0756b8; }}
    .empty {{ color: #667085; }}
    .status-ok {{ color: #067647; }}
    .status-failed {{ color: #b42318; }}
    pre {{ white-space: pre-wrap; font-size: 12px; line-height: 1.45; }}
    .svg-page + .svg-page {{ margin-top: 16px; }}
    @media (max-width: 1100px) {{ main {{ grid-template-columns: 1fr; }} }}
  </style>
</head>
<body>
  <header>
    <h1>{html.escape(case.case_dir.name)}</h1>
    <p class="{ "status-failed" if case.errors else "status-ok" }">Status: {status}</p>
  </header>
  <nav class="links">
    <a href="prediction.krn" download>prediction.krn</a>
    {mei_link}
    {mei_converter_link}
    {raw_musicxml_link}
    {mei_musicxml_link}
    <a href="diagnostics.json" download>diagnostics.json</a>
  </nav>
  <main>
    <section class="panel">
      <h2>Input</h2>
      {source_image_html}
    </section>
    <section class="panel">
      <h2>KERN -> Verovio SVG</h2>
      {render_svg_items(case.kern_svg_paths, case.case_dir)}
    </section>
    <section class="panel">
      <h2>KERN -> MusicXML -> Verovio SVG</h2>
      <p class="empty">Raw converter21 output.</p>
      {render_svg_items(case.raw_musicxml_svg_paths, case.case_dir)}
    </section>
    <section class="panel">
      <h2>KERN -> MEI -> MusicXML -> Verovio SVG</h2>
      <p class="empty">KERN parsed by Verovio, MEI converted by converter21.</p>
      {render_svg_items(case.mei_musicxml_svg_paths, case.case_dir)}
    </section>
    <section class="panel">
      <h2>KERN</h2>
      <pre>{html.escape(kern_text)}</pre>
    </section>
    <section class="panel">
      <h2>Warnings</h2>
      <ul>{warnings or '<li class="empty">None</li>'}</ul>
    </section>
    <section class="panel">
      <h2>Errors</h2>
      <ul>{errors or '<li class="empty">None</li>'}</ul>
    </section>
  </main>
</body>
</html>
"""
    (case.case_dir / "index.html").write_text(page, encoding="utf-8")


def write_case_diagnostics(case: RenderedCase) -> None:
    payload = {
        "case": case.case_dir.name,
        "kern_source": str(case.kern_path),
        "source_image": str(case.source_image) if case.source_image else None,
        "mei": case.mei_path.name if case.mei_path else None,
        "mei_converter_input": (
            case.mei_converter_path.name if case.mei_converter_path else None
        ),
        "raw_musicxml": case.raw_musicxml_path.name if case.raw_musicxml_path else None,
        "mei_musicxml": case.mei_musicxml_path.name if case.mei_musicxml_path else None,
        "kern_svg_pages": [path.relative_to(case.case_dir).as_posix() for path in case.kern_svg_paths],
        "raw_musicxml_svg_pages": [
            path.relative_to(case.case_dir).as_posix() for path in case.raw_musicxml_svg_paths
        ],
        "mei_musicxml_svg_pages": [
            path.relative_to(case.case_dir).as_posix() for path in case.mei_musicxml_svg_paths
        ],
        "warnings": case.warnings,
        "errors": case.errors,
    }
    (case.case_dir / "diagnostics.json").write_text(
        json.dumps(payload, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def render_gallery(output_dir: Path, cases: Iterable[RenderedCase]) -> None:
    items = "\n".join(
        f'<li><a href="{html.escape(case.case_dir.name)}/index.html">{html.escape(case.case_dir.name)}</a>'
        f' <span class="{ "failed" if case.errors else "ok" }">{ "FAILED" if case.errors else "OK" }</span></li>'
        for case in cases
    )
    page = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Transcoda KERN Visual Probe</title>
  <style>
    body {{ margin: 0; font-family: system-ui, sans-serif; background: #f6f7f9; color: #172033; }}
    main {{ max-width: 880px; margin: 0 auto; padding: 24px; }}
    a {{ color: #0756b8; }}
    li {{ margin: 8px 0; }}
    .ok {{ color: #067647; }}
    .failed {{ color: #b42318; }}
  </style>
</head>
<body>
  <main>
    <h1>Transcoda KERN Visual Probe</h1>
    <p>Each case compares direct KERN rendering with raw and MEI-mediated KERN -> MusicXML -> Verovio rendering.</p>
    <ul>{items}</ul>
  </main>
</body>
</html>
"""
    (output_dir / "index.html").write_text(page, encoding="utf-8")


def process_case(
    args: argparse.Namespace,
    kern_path: Path,
    source_image: Path | None,
    output_dir: Path,
    index: int,
) -> RenderedCase:
    case_dir = output_dir / safe_slug(kern_path, index)
    case_dir.mkdir(parents=True, exist_ok=True)
    copied_kern = copy_source_file(kern_path, case_dir, "prediction")
    copied_image = copy_source_file(source_image, case_dir, "input") if source_image else None
    case = RenderedCase(case_dir=case_dir, kern_path=kern_path, source_image=copied_image)

    try:
        case.kern_svg_paths = render_with_verovio(
            copied_kern,
            case_dir / "kern-verovio",
            "humdrum",
            args.page_width,
            args.page_height,
            args.scale,
            args.breaks,
        )
    except Exception as exc:
        case.errors.append(f"KERN direct Verovio render failed: {type(exc).__name__}: {exc}")
        if args.stop_on_error:
            raise

    raw_musicxml_path = case_dir / "prediction.raw.musicxml"
    try:
        convert_kern_to_musicxml(copied_kern, raw_musicxml_path)
        case.raw_musicxml_path = raw_musicxml_path
    except Exception as exc:
        case.errors.append(f"KERN -> MusicXML conversion failed: {type(exc).__name__}: {exc}")
        if args.stop_on_error:
            raise

    if case.raw_musicxml_path is not None:
        try:
            case.raw_musicxml_svg_paths = render_with_verovio(
                case.raw_musicxml_path,
                case_dir / "musicxml-raw-verovio",
                "xml",
                args.page_width,
                args.page_height,
                args.scale,
                args.breaks,
            )
        except Exception as exc:
            case.errors.append(f"MusicXML Verovio render failed: {type(exc).__name__}: {exc}")
            if args.stop_on_error:
                raise

    mei_path = case_dir / "prediction.verovio.mei"
    try:
        convert_kern_to_mei_with_verovio(
            copied_kern,
            mei_path,
            args.page_width,
            args.page_height,
            args.scale,
            args.breaks,
        )
        case.mei_path = mei_path
    except Exception as exc:
        case.errors.append(f"KERN -> Verovio MEI conversion failed: {type(exc).__name__}: {exc}")
        if args.stop_on_error:
            raise

    if case.mei_path is not None:
        mei_converter_path = case_dir / "prediction.verovio.mei5.mei"
        try:
            downgrade_verovio_mei_for_converter21(case.mei_path, mei_converter_path)
            case.mei_converter_path = mei_converter_path
        except Exception as exc:
            case.errors.append(
                f"MEI compatibility rewrite failed: {type(exc).__name__}: {exc}"
            )
            if args.stop_on_error:
                raise

    if case.mei_converter_path is not None:
        mei_musicxml_path = case_dir / "prediction.mei.musicxml"
        try:
            convert_mei_to_musicxml(case.mei_converter_path, mei_musicxml_path)
            case.mei_musicxml_path = mei_musicxml_path
        except Exception as exc:
            case.errors.append(f"MEI -> MusicXML conversion failed: {type(exc).__name__}: {exc}")
            if args.stop_on_error:
                raise

    if case.mei_musicxml_path is not None:
        try:
            case.mei_musicxml_svg_paths = render_with_verovio(
                case.mei_musicxml_path,
                case_dir / "musicxml-mei-verovio",
                "xml",
                args.page_width,
                args.page_height,
                args.scale,
                args.breaks,
            )
        except Exception as exc:
            case.errors.append(f"MEI MusicXML Verovio render failed: {type(exc).__name__}: {exc}")
            if args.stop_on_error:
                raise

    if source_image is None:
        case.warnings.append("No matching source image was supplied for visual side-by-side comparison.")

    write_case_diagnostics(case)
    render_case_page(case)
    return case


def main() -> int:
    backend_root = _backend_root()
    parser = _build_parser(backend_root)
    args = parser.parse_args()

    kern_paths = collect_kern_files(args)
    image_matches = collect_images(args, kern_paths)
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    cases: list[RenderedCase] = []
    for index, kern_path in enumerate(kern_paths, 1):
        print(f"[KERN] {kern_path}")
        case = process_case(args, kern_path, image_matches.get(kern_path), output_dir, index)
        cases.append(case)
        if case.errors:
            print(f"  FAILED: {'; '.join(case.errors)}")
        else:
            print(f"  OK: {case.case_dir / 'index.html'}")

    render_gallery(output_dir, cases)
    print(f"\nGallery: {output_dir / 'index.html'}")
    return 1 if any(case.errors for case in cases) else 0


if __name__ == "__main__":
    sys.exit(main())
