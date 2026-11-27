"""Generate the two runtime projections of the Score tempo product policy."""

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    policy = json.loads((ROOT / "contracts/score/tempo-policy.json").read_text())
    if (
        set(policy) != {"defaultScoreTempoBpm", "bpmUnit"}
        or type(policy["defaultScoreTempoBpm"]) is not int
        or policy["defaultScoreTempoBpm"] <= 0
        or policy["bpmUnit"] != "QUARTER_NOTES_PER_MINUTE"
    ):
        raise ValueError("Invalid Score tempo policy")
    bpm = policy["defaultScoreTempoBpm"]
    source = "Generated from contracts/score/tempo-policy.json. Do not edit."
    projections = {
        "backend/app/score_semantics/tempo_policy.py": f'"""{source}"""\n\nDEFAULT_SCORE_TEMPO_BPM = {bpm}\n',
        "apps/customer-web/src/lib/score/tempo-policy.ts": f"// {source}\nexport const DEFAULT_SCORE_TEMPO_BPM = {bpm};\n",
    }
    for name, content in projections.items():
        path = ROOT / name
        if args.check:
            if not path.exists() or path.read_text(encoding="utf-8") != content:
                raise SystemExit(f"Score tempo policy projection differs: {name}")
        else:
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text(content, encoding="utf-8", newline="\n")
    print("Score tempo policy projections agree.")


if __name__ == "__main__":
    main()
