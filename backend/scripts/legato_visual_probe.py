#!/usr/bin/env python3
"""Run a visual LEGATO probe: image -> ABC/MusicXML -> Verovio SVG gallery.

This script is intentionally standalone. It does not import the NoteVerse app,
touch the database, or call the production processing pipeline.
"""

from __future__ import annotations

import argparse
import html
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Iterable


IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".bmp", ".webp", ".tif", ".tiff"}


def _build_parser(repo_root: Path) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Render LEGATO ABC predictions with Verovio for visual review."
    )
    parser.add_argument(
        "--image",
        action="append",
        default=[],
        help="Image file to process. Can be passed multiple times.",
    )
    parser.add_argument(
        "--image-dir",
        default=str(repo_root / "backend" / "var" / "uploads" / "scores"),
        help="Directory of score images to process when --image is omitted.",
    )
    parser.add_argument(
        "--output-dir",
        default=str(repo_root / "backend" / "var" / "legato-visual-probe"),
        help="Directory for JSON, ABC, SVG, and HTML outputs.",
    )
    parser.add_argument(
        "--legato-repo",
        default=str(repo_root / "external" / "legato"),
        help="Path to the cloned guang-yng/legato repository.",
    )
    parser.add_argument(
        "--python",
        default=sys.executable,
        help="Python executable in the environment where LEGATO is installed.",
    )
    parser.add_argument(
        "--model-path",
        default="guangyangmusic/legato",
        help="Hugging Face model ID or local LEGATO model directory.",
    )
    parser.add_argument(
        "--processor-path",
        default=None,
        help="Optional processor path. Defaults to --model-path in LEGATO.",
    )
    parser.add_argument("--device", default="cuda", help="LEGATO device: cuda or cpu.")
    parser.add_argument("--beam-size", type=int, default=10, help="LEGATO beam size.")
    parser.add_argument("--fp16", action="store_true", help="Use fp16 inference.")
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum number of images to process from --image-dir.",
    )
    parser.add_argument(
        "--skip-inference",
        action="store_true",
        help="Reuse existing prediction_abc.json files and only render/report.",
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
    return parser


def collect_images(args: argparse.Namespace) -> list[Path]:
    if args.image:
        images = [Path(value).expanduser().resolve() for value in args.image]
    else:
        image_dir = Path(args.image_dir).expanduser().resolve()
        images = sorted(
            path
            for path in image_dir.iterdir()
            if path.is_file() and path.suffix.lower() in IMAGE_EXTENSIONS
        )

    if args.limit is not None:
        images = images[: args.limit]

    missing = [str(path) for path in images if not path.exists()]
    if missing:
        raise FileNotFoundError(f"Image file(s) not found: {', '.join(missing)}")
    if not images:
        raise FileNotFoundError("No score images found.")
    return images


def run_legato_inference(
    args: argparse.Namespace,
    image_path: Path,
    prediction_path: Path,
) -> None:
    legato_repo = Path(args.legato_repo).expanduser().resolve()
    if not (legato_repo / "legato" / "models").exists():
        raise FileNotFoundError(f"LEGATO repository not found: {legato_repo}")

    prediction_path.parent.mkdir(parents=True, exist_ok=True)
    runner_path = prediction_path.parent / "_legato_inference_runner.py"
    ensure_inference_runner(runner_path)

    command = [
        args.python,
        str(runner_path),
        "--model_path",
        args.model_path,
        "--processor_path",
        args.processor_path or args.model_path,
        "--image_path",
        str(image_path),
        "--output_path",
        str(prediction_path),
        "--device",
        args.device,
        "--beam_size",
        str(args.beam_size),
    ]
    if args.fp16:
        command.append("--fp16")

    env = os.environ.copy()
    current_pythonpath = env.get("PYTHONPATH")
    env["PYTHONPATH"] = (
        str(legato_repo)
        if not current_pythonpath
        else f"{legato_repo}{os.pathsep}{current_pythonpath}"
    )

    print(f"[LEGATO] {image_path.name}")
    result = subprocess.run(
        command,
        cwd=str(legato_repo),
        env=env,
        capture_output=True,
        text=True,
    )
    (prediction_path.parent / "legato_stdout.txt").write_text(
        result.stdout,
        encoding="utf-8",
    )
    (prediction_path.parent / "legato_stderr.txt").write_text(
        result.stderr,
        encoding="utf-8",
    )
    if result.returncode != 0:
        stderr_tail = "\n".join(result.stderr.splitlines()[-20:])
        raise RuntimeError(
            f"LEGATO inference failed for {image_path.name}. "
            f"See {prediction_path.parent / 'legato_stderr.txt'}\n{stderr_tail}"
        )


def ensure_inference_runner(runner_path: Path) -> None:
    """Write a tiny inference runner that explicitly loads LEGATO's processor.

    LEGATO's upstream script currently goes through AutoProcessor. In some
    transformer versions that fails to resolve the custom LegatoProcessor even
    though the model repository contains tokenizer and preprocessor files.
    """

    runner_path.write_text(
        """from __future__ import annotations

import argparse
import json

import torch
from PIL import Image
from transformers import GenerationConfig

from legato.models import LegatoModel
from legato.models.processing_legato import LegatoProcessor


def remove_special_tokens(arrays, special_tokens):
    outputs = []
    for array in arrays:
        outputs.append([tok for tok in array if tok not in special_tokens])
    return outputs


parser = argparse.ArgumentParser()
parser.add_argument("--model_path", required=True)
parser.add_argument("--processor_path", required=True)
parser.add_argument("--image_path", required=True)
parser.add_argument("--output_path", required=True)
parser.add_argument("--device", default="cuda")
parser.add_argument("--beam_size", type=int, default=10)
parser.add_argument("--fp16", action="store_true")
args = parser.parse_args()

model = LegatoModel.from_pretrained(args.model_path)
processor = LegatoProcessor.from_pretrained(args.processor_path)
generation_config = GenerationConfig(
    max_length=2048,
    num_beams=args.beam_size,
    repetition_penalty=1.1,
)

image = Image.open(args.image_path).convert("RGB")
model = model.to(device=args.device)
if args.fp16:
    model = model.half()

inputs = processor(images=[image], truncation=True, return_tensors="pt")
inputs = {key: value.to(args.device) for key, value in inputs.items()}

with torch.no_grad():
    outputs = model.generate(
        **inputs,
        generation_config=generation_config,
        use_model_defaults=False,
    )

output_tokens = outputs.tolist()
abc_outputs = processor.batch_decode(output_tokens, skip_special_tokens=True)
special_tokens = processor.tokenizer.all_special_ids
preds = remove_special_tokens(output_tokens, special_tokens)

with open(args.output_path, "w", encoding="utf-8") as file_handle:
    json.dump(
        {"abc_transcription": abc_outputs, "tokens": preds},
        file_handle,
        ensure_ascii=False,
    )

print(abc_outputs[0])
print("Inference completed. Output saved to:", args.output_path)
""",
        encoding="utf-8",
    )


def read_abc(prediction_path: Path) -> str:
    data = json.loads(prediction_path.read_text(encoding="utf-8"))
    transcriptions = data.get("abc_transcription")
    if not isinstance(transcriptions, list) or not transcriptions:
        raise ValueError(f"No abc_transcription found in {prediction_path}")
    abc = transcriptions[0]
    if not isinstance(abc, str) or not abc.strip():
        raise ValueError(f"Empty ABC transcription in {prediction_path}")
    return abc


def render_abc_to_svgs(
    abc: str,
    output_dir: Path,
    page_width: int,
    page_height: int,
    scale: int,
) -> list[Path]:
    try:
        import verovio
    except ImportError as exc:
        raise RuntimeError(
            "Python package 'verovio' is not installed in this environment. "
            "Install it with: pip install verovio"
        ) from exc

    toolkit = verovio.toolkit()
    toolkit.setOptions(
        {
            "inputFrom": "abc",
            "pageWidth": page_width,
            "pageHeight": page_height,
            "scale": scale,
            "adjustPageHeight": True,
        }
    )

    if not toolkit.loadData(abc):
        log = toolkit.getLog() if hasattr(toolkit, "getLog") else ""
        raise RuntimeError(f"Verovio failed to load ABC data. {log}")

    page_count = toolkit.getPageCount()
    if page_count <= 0:
        raise RuntimeError("Verovio produced zero pages.")

    svg_paths: list[Path] = []
    output_dir.mkdir(parents=True, exist_ok=True)
    for page in range(1, page_count + 1):
        svg = toolkit.renderToSVG(page)
        svg_path = output_dir / f"page-{page:02d}.svg"
        svg_path.write_text(svg, encoding="utf-8")
        svg_paths.append(svg_path)
    return svg_paths


def convert_abc_to_musicxml(args: argparse.Namespace, abc: str, case_dir: Path) -> Path:
    """Convert LEGATO ABC to MusicXML using LEGATO's cleanup + abc2xml tool."""

    legato_repo = Path(args.legato_repo).expanduser().resolve()
    convert_path = legato_repo / "utils" / "convert.py"
    abc2xml_path = legato_repo / "utils" / "abc2xml.py"
    if not convert_path.exists():
        raise FileNotFoundError(f"LEGATO convert.py not found: {convert_path}")
    if not abc2xml_path.exists():
        raise FileNotFoundError(f"LEGATO abc2xml.py not found: {abc2xml_path}")

    cleanup_abc = load_legato_cleanup_abc(convert_path)
    clean_abc = cleanup_abc(abc)
    clean_abc_path = case_dir / "prediction.cleaned.abc"
    clean_abc_path.write_text(clean_abc, encoding="utf-8")

    result = subprocess.run(
        [args.python, str(abc2xml_path), "-"],
        input=clean_abc.encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=str(legato_repo),
    )
    (case_dir / "abc2xml_stderr.txt").write_text(
        result.stderr.decode("utf-8", errors="replace"),
        encoding="utf-8",
    )
    if result.returncode != 0:
        stderr_tail = "\n".join(
            result.stderr.decode("utf-8", errors="replace").splitlines()[-20:]
        )
        raise RuntimeError(
            "LEGATO ABC to MusicXML conversion failed. "
            f"See {case_dir / 'abc2xml_stderr.txt'}\n{stderr_tail}"
        )

    xml_path = case_dir / "prediction.musicxml"
    xml_path.write_text(result.stdout.decode("utf-8", errors="replace"), encoding="utf-8")
    normalize_initial_musicxml_clefs(xml_path)
    return xml_path


def normalize_initial_musicxml_clefs(xml_path: Path) -> None:
    """Move initial staff clefs into the first measure's opening attributes.

    abc2xml can emit the bass clef after the first staff has already been
    written and a backup has moved time back for staff 2. MuseScore tolerates
    that and visually moves the initial clef to the system start; Verovio
    renders the clef at its encoded position. Normalizing the first measure
    gives both renderers the same structural hint.
    """

    tree = ET.parse(xml_path)
    root = tree.getroot()
    first_measure = root.find("./part/measure")
    if first_measure is None:
        return

    opening_attributes = first_measure.find("attributes")
    if opening_attributes is None:
        opening_attributes = ET.Element("attributes")
        first_measure.insert(0, opening_attributes)

    opening_clef_numbers = {
        clef.get("number", "1") for clef in opening_attributes.findall("clef")
    }
    changed = False

    for attributes in list(first_measure.findall("attributes"))[1:]:
        for clef in list(attributes.findall("clef")):
            number = clef.get("number", "1")
            if number in opening_clef_numbers:
                continue
            attributes.remove(clef)
            opening_attributes.append(clef)
            opening_clef_numbers.add(number)
            changed = True

        if len(list(attributes)) == 0:
            first_measure.remove(attributes)
            changed = True

    if changed:
        indent_xml(root)
        tree.write(xml_path, encoding="utf-8", xml_declaration=True)


def indent_xml(element: ET.Element, level: int = 0) -> None:
    indent = "\n" + level * "  "
    if len(element):
        if not element.text or not element.text.strip():
            element.text = indent + "  "
        for child in element:
            indent_xml(child, level + 1)
        if not child.tail or not child.tail.strip():
            child.tail = indent
    if level and (not element.tail or not element.tail.strip()):
        element.tail = indent


def load_legato_cleanup_abc(convert_path: Path):
    spec = importlib.util.spec_from_file_location("legato_convert", convert_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Could not load LEGATO convert module: {convert_path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module.cleanup_abc


def render_musicxml_to_svgs(
    musicxml_path: Path,
    output_dir: Path,
    page_width: int,
    page_height: int,
    scale: int,
) -> list[Path]:
    try:
        import verovio
    except ImportError as exc:
        raise RuntimeError(
            "Python package 'verovio' is not installed in this environment. "
            "Install it with: pip install verovio"
        ) from exc

    toolkit = verovio.toolkit()
    toolkit.setOptions(
        {
            "inputFrom": "xml",
            "pageWidth": page_width,
            "pageHeight": page_height,
            "scale": scale,
            "adjustPageHeight": True,
            "breaks": "encoded",
        }
    )

    if not toolkit.loadFile(str(musicxml_path)):
        log = toolkit.getLog() if hasattr(toolkit, "getLog") else ""
        raise RuntimeError(f"Verovio failed to load MusicXML data. {log}")

    page_count = toolkit.getPageCount()
    if page_count <= 0:
        raise RuntimeError("Verovio produced zero pages from MusicXML.")

    svg_paths: list[Path] = []
    output_dir.mkdir(parents=True, exist_ok=True)
    for page in range(1, page_count + 1):
        svg = toolkit.renderToSVG(page)
        svg_path = output_dir / f"page-{page:02d}.svg"
        svg_path.write_text(svg, encoding="utf-8")
        svg_paths.append(svg_path)
    return svg_paths


def copy_source_image(image_path: Path, case_dir: Path) -> Path:
    target = case_dir / f"input{image_path.suffix.lower()}"
    shutil.copy2(image_path, target)
    return target


def case_slug(image_path: Path, index: int) -> str:
    return f"{index:03d}-{image_path.stem[:24]}"


def render_svg_items(paths: list[Path], relative_to: Path) -> str:
    return "\n".join(
        f'<section class="svg-page"><img src="{html.escape(path.relative_to(relative_to).as_posix())}" alt="{html.escape(path.name)}"></section>'
        for path in paths
    )


def render_case_page(
    case_dir: Path,
    source_image: Path,
    abc_path: Path,
    musicxml_path: Path,
    abc_svg_paths: list[Path],
    musicxml_svg_paths: list[Path],
) -> None:
    abc_svg_items = render_svg_items(abc_svg_paths, case_dir)
    musicxml_svg_items = render_svg_items(musicxml_svg_paths, case_dir)
    page = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LEGATO Visual Probe - {html.escape(case_dir.name)}</title>
  <style>
    body {{ margin: 0; font-family: system-ui, sans-serif; background: #f6f7f9; color: #172033; }}
    header {{ padding: 16px 20px; background: white; border-bottom: 1px solid #d8dee8; }}
    main {{ display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; padding: 16px; }}
    .panel {{ background: white; border: 1px solid #d8dee8; border-radius: 8px; padding: 12px; overflow: auto; }}
    img {{ max-width: 100%; height: auto; display: block; }}
    .links {{ display: flex; flex-wrap: wrap; gap: 12px; padding: 0 16px 16px; }}
    .links a {{ color: #0756b8; }}
    pre {{ white-space: pre-wrap; font-size: 12px; line-height: 1.45; }}
    .svg-page + .svg-page {{ margin-top: 16px; }}
    @media (max-width: 1100px) {{ main {{ grid-template-columns: 1fr; }} }}
  </style>
</head>
<body>
  <header>
    <h1>{html.escape(case_dir.name)}</h1>
  </header>
  <nav class="links">
    <a href="{html.escape(abc_path.name)}" download>prediction.abc</a>
    <a href="{html.escape(musicxml_path.name)}" download>prediction.musicxml</a>
  </nav>
  <main>
    <section class="panel">
      <h2>Input</h2>
      <img src="{html.escape(source_image.name)}" alt="Input score image">
    </section>
    <section class="panel">
      <h2>ABC -> Verovio SVG</h2>
      {abc_svg_items}
    </section>
    <section class="panel">
      <h2>ABC -> MusicXML -> Verovio SVG</h2>
      {musicxml_svg_items}
    </section>
    <section class="panel">
      <h2>ABC</h2>
      <pre>{html.escape(abc_path.read_text(encoding="utf-8"))}</pre>
    </section>
  </main>
</body>
</html>
"""
    (case_dir / "index.html").write_text(page, encoding="utf-8")


def render_gallery(output_dir: Path, case_dirs: Iterable[Path]) -> None:
    items = "\n".join(
        f'<li><a href="{html.escape(case_dir.name)}/index.html">{html.escape(case_dir.name)}</a></li>'
        for case_dir in case_dirs
    )
    page = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LEGATO Visual Probe</title>
  <style>
    body {{ margin: 0; font-family: system-ui, sans-serif; background: #f6f7f9; color: #172033; }}
    main {{ max-width: 880px; margin: 0 auto; padding: 24px; }}
    a {{ color: #0756b8; }}
    li {{ margin: 8px 0; }}
  </style>
</head>
<body>
  <main>
    <h1>LEGATO Visual Probe</h1>
    <ul>{items}</ul>
  </main>
</body>
</html>
"""
    (output_dir / "index.html").write_text(page, encoding="utf-8")


def process_image(args: argparse.Namespace, image_path: Path, output_dir: Path, index: int) -> Path:
    case_dir = output_dir / case_slug(image_path, index)
    case_dir.mkdir(parents=True, exist_ok=True)
    source_image = copy_source_image(image_path, case_dir)
    prediction_path = case_dir / "prediction_abc.json"

    if not args.skip_inference or not prediction_path.exists():
        run_legato_inference(args, image_path, prediction_path)

    abc = read_abc(prediction_path)
    abc_path = case_dir / "prediction.abc"
    abc_path.write_text(abc, encoding="utf-8")

    abc_svg_paths = render_abc_to_svgs(
        abc,
        case_dir / "abc-verovio",
        page_width=args.page_width,
        page_height=args.page_height,
        scale=args.scale,
    )
    musicxml_path = convert_abc_to_musicxml(args, abc, case_dir)
    musicxml_svg_paths = render_musicxml_to_svgs(
        musicxml_path,
        case_dir / "musicxml-verovio",
        page_width=args.page_width,
        page_height=args.page_height,
        scale=args.scale,
    )
    render_case_page(
        case_dir,
        source_image,
        abc_path,
        musicxml_path,
        abc_svg_paths,
        musicxml_svg_paths,
    )
    print(f"[OK] {case_dir / 'index.html'}")
    return case_dir


def main() -> int:
    parser = _build_parser(Path(__file__).resolve().parents[2])
    args = parser.parse_args()

    images = collect_images(args)
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    case_dirs: list[Path] = []
    for index, image_path in enumerate(images, 1):
        case_dirs.append(process_image(args, image_path, output_dir, index))

    render_gallery(output_dir, case_dirs)
    print(f"[DONE] Open {output_dir / 'index.html'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
