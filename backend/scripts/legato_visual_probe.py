#!/usr/bin/env python3
"""Run a visual LEGATO probe: image -> ABC/MusicXML -> Verovio SVG gallery.

This script is intentionally standalone. It does not import the NoteVerse app,
touch the database, or call the production processing pipeline.
"""

from __future__ import annotations

import argparse
import copy
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
    parser.add_argument("--batch-size", type=int, default=1, help="LEGATO batch size.")
    parser.add_argument("--fp16", action="store_true", help="Use fp16 inference.")
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Maximum number of images to process from --image-dir.",
    )
    parser.add_argument(
        "--as-score",
        action="store_true",
        help="Treat collected images as ordered pages of one score and render a merged MusicXML result.",
    )
    parser.add_argument(
        "--score-name",
        default=None,
        help="Optional output case name for --as-score mode.",
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
        "--batch_size",
        str(args.batch_size),
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


def run_legato_batch_inference(
    args: argparse.Namespace,
    image_paths: list[Path],
    prediction_path: Path,
) -> None:
    legato_repo = Path(args.legato_repo).expanduser().resolve()
    if not (legato_repo / "legato" / "models").exists():
        raise FileNotFoundError(f"LEGATO repository not found: {legato_repo}")

    prediction_path.parent.mkdir(parents=True, exist_ok=True)
    runner_path = prediction_path.parent / "_legato_inference_runner.py"
    image_list_path = prediction_path.parent / "image_list.json"
    ensure_inference_runner(runner_path)
    image_list_path.write_text(
        json.dumps([str(path) for path in image_paths], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    command = [
        args.python,
        str(runner_path),
        "--model_path",
        args.model_path,
        "--processor_path",
        args.processor_path or args.model_path,
        "--image_list",
        str(image_list_path),
        "--output_path",
        str(prediction_path),
        "--device",
        args.device,
        "--beam_size",
        str(args.beam_size),
        "--batch_size",
        str(args.batch_size),
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

    print(f"[LEGATO] batch pages={len(image_paths)}")
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
            "LEGATO batch inference failed. "
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
parser.add_argument("--image_path")
parser.add_argument("--image_list")
parser.add_argument("--output_path", required=True)
parser.add_argument("--device", default="cuda")
parser.add_argument("--beam_size", type=int, default=10)
parser.add_argument("--batch_size", type=int, default=1)
parser.add_argument("--fp16", action="store_true")
args = parser.parse_args()

if bool(args.image_path) == bool(args.image_list):
    raise ValueError("Pass exactly one of --image_path or --image_list.")

model = LegatoModel.from_pretrained(args.model_path)
processor = LegatoProcessor.from_pretrained(args.processor_path)
generation_config = GenerationConfig(
    max_length=2048,
    num_beams=args.beam_size,
    repetition_penalty=1.1,
)

if args.image_list:
    with open(args.image_list, "r", encoding="utf-8") as file_handle:
        image_paths = json.load(file_handle)
    if not isinstance(image_paths, list) or not image_paths:
        raise ValueError("--image_list must contain a non-empty JSON list.")
else:
    image_paths = [args.image_path]

images = [Image.open(path).convert("RGB") for path in image_paths]
model = model.to(device=args.device)
if args.fp16:
    model = model.half()

output_tokens = []
for start in range(0, len(images), args.batch_size):
    batch_images = images[start:start + args.batch_size]
    inputs = processor(images=batch_images, truncation=True, return_tensors="pt")
    inputs = {key: value.to(args.device) for key, value in inputs.items()}

    with torch.no_grad():
        outputs = model.generate(
            **inputs,
            generation_config=generation_config,
            use_model_defaults=False,
        )

    output_tokens.extend(outputs.tolist())
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
    return read_abcs(prediction_path)[0]


def read_abcs(prediction_path: Path) -> list[str]:
    data = json.loads(prediction_path.read_text(encoding="utf-8"))
    transcriptions = data.get("abc_transcription")
    if not isinstance(transcriptions, list) or not transcriptions:
        raise ValueError(f"No abc_transcription found in {prediction_path}")
    abcs: list[str] = []
    for index, abc in enumerate(transcriptions, 1):
        if not isinstance(abc, str) or not abc.strip():
            raise ValueError(f"Empty ABC transcription #{index} in {prediction_path}")
        abcs.append(abc)
    return abcs


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
    return convert_abc_to_musicxml_file(args, abc, case_dir, "prediction")


def convert_abc_to_musicxml_file(
    args: argparse.Namespace,
    abc: str,
    case_dir: Path,
    stem: str,
) -> Path:
    """Convert one LEGATO ABC string to a named MusicXML file."""
    legato_repo = Path(args.legato_repo).expanduser().resolve()
    convert_path = legato_repo / "utils" / "convert.py"
    abc2xml_path = legato_repo / "utils" / "abc2xml.py"
    if not convert_path.exists():
        raise FileNotFoundError(f"LEGATO convert.py not found: {convert_path}")
    if not abc2xml_path.exists():
        raise FileNotFoundError(f"LEGATO abc2xml.py not found: {abc2xml_path}")

    cleanup_abc = load_legato_cleanup_abc(convert_path)
    clean_abc = cleanup_abc(abc)
    clean_abc_path = case_dir / f"{stem}.cleaned.abc"
    clean_abc_path.write_text(clean_abc, encoding="utf-8")

    result = subprocess.run(
        [args.python, str(abc2xml_path), "-"],
        input=clean_abc.encode("utf-8"),
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
        cwd=str(legato_repo),
    )
    (case_dir / f"{stem}.abc2xml_stderr.txt").write_text(
        result.stderr.decode("utf-8", errors="replace"),
        encoding="utf-8",
    )
    if result.returncode != 0:
        stderr_tail = "\n".join(
            result.stderr.decode("utf-8", errors="replace").splitlines()[-20:]
        )
        raise RuntimeError(
            "LEGATO ABC to MusicXML conversion failed. "
            f"See {case_dir / f'{stem}.abc2xml_stderr.txt'}\n{stderr_tail}"
        )

    xml_path = case_dir / f"{stem}.musicxml"
    xml_path.write_text(result.stdout.decode("utf-8", errors="replace"), encoding="utf-8")
    normalize_initial_musicxml_clefs(xml_path)
    return xml_path


def normalize_initial_musicxml_clefs(xml_path: Path) -> None:
    """Move initial staff clefs into the first measure's opening attributes.

    abc2xml can emit the bass clef after the first staff has already been
    written and a backup has moved time back for staff 2. Tolerant readers may
    move that clef to the system start, while stricter renderers preserve its
    encoded position. Normalizing the first measure makes the structure clear.
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


def merge_musicxml_pages(page_xml_paths: list[Path], output_path: Path) -> Path:
    if not page_xml_paths:
        raise ValueError("No MusicXML pages to merge.")

    base_tree = ET.parse(page_xml_paths[0])
    base_root = base_tree.getroot()
    base_parts = collect_musicxml_parts(base_root)
    base_part_ids = list(base_parts.keys())
    if not base_part_ids:
        raise ValueError(f"No MusicXML parts found in {page_xml_paths[0]}")

    next_measure_number = {
        part_id: len(base_parts[part_id].findall("measure")) + 1
        for part_id in base_part_ids
    }

    for page_index, page_xml_path in enumerate(page_xml_paths[1:], 2):
        page_root = ET.parse(page_xml_path).getroot()
        page_parts = collect_musicxml_parts(page_root)
        page_part_ids = list(page_parts.keys())
        if page_part_ids != base_part_ids:
            raise ValueError(
                "Cannot merge MusicXML pages with different part order: "
                f"{page_xml_paths[0]} has {base_part_ids}, "
                f"{page_xml_path} has {page_part_ids}"
            )

        for part_offset, part_id in enumerate(base_part_ids):
            source_part = page_parts[part_id]
            target_part = base_parts[part_id]
            measures = source_part.findall("measure")
            if not measures:
                continue

            for measure_offset, measure in enumerate(measures):
                copied_measure = copy.deepcopy(measure)
                copied_measure.set("number", str(next_measure_number[part_id]))
                if part_offset == 0 and measure_offset == 0:
                    add_new_page_print(copied_measure, page_index)
                target_part.append(copied_measure)
                next_measure_number[part_id] += 1

    indent_xml(base_root)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    base_tree.write(output_path, encoding="utf-8", xml_declaration=True)
    normalize_initial_musicxml_clefs(output_path)
    return output_path


def analyze_musicxml_systems(xml_path: Path, measure_offset: int = 0) -> dict[str, object]:
    root = ET.parse(xml_path).getroot()
    first_part = root.find("part")
    if first_part is None:
        return {"measure_count": 0, "systems": []}

    systems: list[list[int]] = []
    current_system: list[int] = []
    for index, measure in enumerate(first_part.findall("measure"), 1):
        print_element = measure.find("print")
        if (
            current_system
            and print_element is not None
            and (
                print_element.get("new-system") == "yes"
                or print_element.get("new-page") == "yes"
            )
        ):
            systems.append(current_system)
            current_system = []
        current_system.append(measure_offset + index)

    if current_system:
        systems.append(current_system)

    return {
        "measure_count": sum(len(system) for system in systems),
        "systems": [
            {
                "start": system[0],
                "end": system[-1],
                "count": len(system),
            }
            for system in systems
            if system
        ],
    }


def format_system_summary(analysis: dict[str, object]) -> str:
    systems = analysis.get("systems")
    if not isinstance(systems, list) or not systems:
        return "0 measures"
    ranges = []
    for system in systems:
        if not isinstance(system, dict):
            continue
        start = system.get("start")
        end = system.get("end")
        if start == end:
            ranges.append(str(start))
        else:
            ranges.append(f"{start}-{end}")
    return f"{analysis.get('measure_count', 0)} measures; systems: {', '.join(ranges)}"


def collect_musicxml_parts(root: ET.Element) -> dict[str, ET.Element]:
    parts: dict[str, ET.Element] = {}
    for part in root.findall("part"):
        part_id = part.get("id")
        if part_id:
            parts[part_id] = part
    return parts


def add_new_page_print(measure: ET.Element, page_index: int) -> None:
    print_element = measure.find("print")
    if print_element is None:
        print_element = ET.Element("print")
        measure.insert(0, print_element)
    print_element.set("new-page", "yes")
    print_element.set("page-number", str(page_index))


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


def copy_source_images(image_paths: list[Path], case_dir: Path) -> list[Path]:
    copied_paths: list[Path] = []
    for index, image_path in enumerate(image_paths, 1):
        target = case_dir / f"input-page-{index:03d}{image_path.suffix.lower()}"
        shutil.copy2(image_path, target)
        copied_paths.append(target)
    return copied_paths


def case_slug(image_path: Path, index: int) -> str:
    return f"{index:03d}-{image_path.stem[:24]}"


def render_svg_items(paths: list[Path], relative_to: Path) -> str:
    return "\n".join(
        f'<section class="svg-page"><img src="{html.escape(path.relative_to(relative_to).as_posix())}" alt="{html.escape(path.name)}"></section>'
        for path in paths
    )


def render_image_items(paths: list[Path], relative_to: Path) -> str:
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


def render_score_case_page(
    case_dir: Path,
    source_images: list[Path],
    page_musicxml_paths: list[Path],
    merged_musicxml_path: Path,
    page_svg_paths: list[list[Path]],
    merged_svg_paths: list[Path],
    page_abc_paths: list[Path],
    page_analyses: list[dict[str, object]],
    merged_analysis: dict[str, object],
) -> None:
    source_items = render_image_items(source_images, case_dir)
    page_items = "\n".join(
        f"""
        <section class="page-group">
          <h3>Page {index:03d}</h3>
          <p>{html.escape(format_system_summary(page_analyses[index - 1]))}</p>
          <p><a href="{html.escape(page_abc_paths[index - 1].name)}" download>ABC</a>
             <a href="{html.escape(page_musicxml_paths[index - 1].name)}" download>MusicXML</a></p>
          {render_svg_items(svg_paths, case_dir)}
        </section>
        """
        for index, svg_paths in enumerate(page_svg_paths, 1)
    )
    merged_items = render_svg_items(merged_svg_paths, case_dir)
    abc_links = "\n".join(
        f'<li><a href="{html.escape(path.name)}" download>{html.escape(path.name)}</a></li>'
        for path in page_abc_paths
    )

    page = f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>LEGATO Multi-Page Visual Probe - {html.escape(case_dir.name)}</title>
  <style>
    body {{ margin: 0; font-family: system-ui, sans-serif; background: #f6f7f9; color: #172033; }}
    header {{ padding: 16px 20px; background: white; border-bottom: 1px solid #d8dee8; }}
    main {{ display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 16px; padding: 16px; }}
    .panel {{ background: white; border: 1px solid #d8dee8; border-radius: 8px; padding: 12px; overflow: auto; }}
    img {{ max-width: 100%; height: auto; display: block; }}
    .links {{ display: flex; flex-wrap: wrap; gap: 12px; padding: 0 16px 16px; }}
    .links a {{ color: #0756b8; }}
    .svg-page + .svg-page, .page-group + .page-group {{ margin-top: 16px; }}
    .page-group {{ border-top: 1px solid #d8dee8; padding-top: 12px; }}
    @media (max-width: 1100px) {{ main {{ grid-template-columns: 1fr; }} }}
  </style>
</head>
<body>
  <header>
    <h1>{html.escape(case_dir.name)}</h1>
    <p>{len(source_images)} input pages</p>
    <p>Merged: {html.escape(format_system_summary(merged_analysis))}</p>
  </header>
  <nav class="links">
    <a href="{html.escape(merged_musicxml_path.name)}" download>merged.musicxml</a>
    <details>
      <summary>Page ABC files</summary>
      <ul>{abc_links}</ul>
    </details>
  </nav>
  <main>
    <section class="panel">
      <h2>Input Pages</h2>
      {source_items}
    </section>
    <section class="panel">
      <h2>Per-Page MusicXML -> Verovio SVG</h2>
      {page_items}
    </section>
    <section class="panel">
      <h2>Merged MusicXML -> Verovio SVG</h2>
      {merged_items}
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


def process_score(args: argparse.Namespace, image_paths: list[Path], output_dir: Path) -> Path:
    score_name = args.score_name or f"score-{image_paths[0].stem[:24]}-{len(image_paths)}pages"
    case_dir = output_dir / score_name
    case_dir.mkdir(parents=True, exist_ok=True)

    source_images = copy_source_images(image_paths, case_dir)
    prediction_path = case_dir / "prediction_abc.json"

    if not args.skip_inference or not prediction_path.exists():
        run_legato_batch_inference(args, image_paths, prediction_path)

    abcs = read_abcs(prediction_path)
    if len(abcs) != len(image_paths):
        raise ValueError(
            "LEGATO output count does not match input page count: "
            f"expected {len(image_paths)}, got {len(abcs)}"
        )

    page_abc_paths: list[Path] = []
    page_musicxml_paths: list[Path] = []
    page_svg_paths: list[list[Path]] = []
    page_analyses: list[dict[str, object]] = []
    running_measure_offset = 0

    for index, abc in enumerate(abcs, 1):
        stem = f"page-{index:03d}"
        abc_path = case_dir / f"{stem}.abc"
        abc_path.write_text(abc, encoding="utf-8")
        page_abc_paths.append(abc_path)

        musicxml_path = convert_abc_to_musicxml_file(args, abc, case_dir, stem)
        page_musicxml_paths.append(musicxml_path)
        analysis = analyze_musicxml_systems(musicxml_path, running_measure_offset)
        page_analyses.append(analysis)
        running_measure_offset += int(analysis["measure_count"])

        page_svg_paths.append(
            render_musicxml_to_svgs(
                musicxml_path,
                case_dir / f"{stem}-musicxml-verovio",
                page_width=args.page_width,
                page_height=args.page_height,
                scale=args.scale,
            )
        )

    merged_musicxml_path = merge_musicxml_pages(
        page_musicxml_paths,
        case_dir / "merged.musicxml",
    )
    merged_analysis = analyze_musicxml_systems(merged_musicxml_path)
    (case_dir / "diagnostics.json").write_text(
        json.dumps(
            {
                "input_pages": [str(path) for path in image_paths],
                "page_analyses": page_analyses,
                "merged_analysis": merged_analysis,
            },
            ensure_ascii=False,
            indent=2,
        ),
        encoding="utf-8",
    )
    merged_svg_paths = render_musicxml_to_svgs(
        merged_musicxml_path,
        case_dir / "merged-musicxml-verovio",
        page_width=args.page_width,
        page_height=args.page_height,
        scale=args.scale,
    )
    render_score_case_page(
        case_dir,
        source_images,
        page_musicxml_paths,
        merged_musicxml_path,
        page_svg_paths,
        merged_svg_paths,
        page_abc_paths,
        page_analyses,
        merged_analysis,
    )
    print(f"[OK] {case_dir / 'index.html'}")
    return case_dir


def main() -> int:
    parser = _build_parser(Path(__file__).resolve().parents[2])
    args = parser.parse_args()
    if args.batch_size <= 0:
        parser.error("--batch-size must be greater than 0")

    images = collect_images(args)
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    if args.as_score:
        case_dirs = [process_score(args, images, output_dir)]
    else:
        case_dirs = []
        for index, image_path in enumerate(images, 1):
            case_dirs.append(process_image(args, image_path, output_dir, index))

    render_gallery(output_dir, case_dirs)
    print(f"[DONE] Open {output_dir / 'index.html'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
