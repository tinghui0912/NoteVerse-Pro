"""Import paths for research tools and scientific modules."""
from pathlib import Path
import sys

RESEARCH_ROOT = Path(__file__).resolve().parents[1]
for directory in (RESEARCH_ROOT.parent, RESEARCH_ROOT, RESEARCH_ROOT / "tools"):
    sys.path.insert(0, str(directory))
