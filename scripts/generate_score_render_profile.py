"""Project the Score presentation render-profile product identity."""

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    value = json.loads((ROOT / "contracts/score/render-profile.json").read_text())
    if (
        set(value) != {"presentationRenderProfile"}
        or not isinstance(value["presentationRenderProfile"], str)
        or not value["presentationRenderProfile"]
    ):
        raise ValueError("Invalid Score presentation render profile")
    profile = json.dumps(value["presentationRenderProfile"])
    source = "Generated from contracts/score/render-profile.json. Do not edit."
    outputs = {
        "backend/app/score_semantics/render_profile.py": f'"""{source}"""\n\nSCORE_PRESENTATION_RENDER_PROFILE = {profile}\n',
        "apps/customer-web/src/lib/score/render-profile.ts": f"// {source}\nexport const SCORE_PRESENTATION_RENDER_PROFILE = {profile};\n",
    }
    for name, content in outputs.items():
        path = ROOT / name
        if args.check:
            if not path.exists() or path.read_text(encoding="utf-8") != content:
                raise SystemExit(f"Score render profile projection differs: {name}")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8", newline="\n")
    print("Score presentation render profile projections agree.")


if __name__ == "__main__":
    main()
