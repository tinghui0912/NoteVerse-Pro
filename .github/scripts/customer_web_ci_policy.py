"""Customer Web CI decisions. Pure policy is separate from Git/GitHub evidence IO."""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
from datetime import datetime
import fnmatch
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
from urllib.error import HTTPError
from urllib.parse import urlencode, urlparse
from urllib.request import HTTPRedirectHandler, Request, build_opener, urlopen
import zipfile


QUALITY_WORKFLOW = ".github/workflows/customer-web-quality.yml"
IMAGE_WORKFLOW = ".github/workflows/customer-web-image.yml"
POLICY_PATHS = {
    ".github/scripts/customer_web_ci_policy.py",
    ".github/scripts/test_customer_web_ci_policy.py",
}
IMAGE_POLICY_TRUST_PATHS = {QUALITY_WORKFLOW, *POLICY_PATHS}
IMAGE_INPUTS = {
    ".dockerignore", IMAGE_WORKFLOW,
    "backend/tests/fixtures/verovio-written-realization.json",
    "backend/tests/fixtures/verovio-playback-profile.json",
    ".github/scripts/frontend_image_security_smoke.mjs",

    "apps/customer-web/package.json", "apps/customer-web/package-lock.json",
    "apps/customer-web/next.config.ts",
    # npm reads these before resolving/installing dependencies, if present.
    "apps/customer-web/.npmrc", "apps/customer-web/npm-shrinkwrap.json",
}


def runtime_relevant(path: str) -> bool:
    if path in IMAGE_INPUTS:
        return True
    if path.startswith("docker/customer-web/"):
        return True
    if not path.startswith("apps/customer-web/"):
        return False
    name = PurePosixPath(path).name
    return not (path.startswith("apps/customer-web/tests/")
                or fnmatch.fnmatchcase(name, "*.test.*")
                or fnmatch.fnmatchcase(name, "*.spec.*"))


def image_risk(path: str) -> bool:
    return path in IMAGE_INPUTS or path.startswith("docker/customer-web/")


def image_policy(event_name: str, paths: list[str]) -> dict[str, bool]:
    if event_name not in {"pull_request", "push", "workflow_dispatch"}:
        raise ValueError("Unsupported image event")
    runtime = event_name == "workflow_dispatch" or any(map(runtime_relevant, paths))
    risk = any(map(image_risk, paths))
    trust_changed = any(path in IMAGE_POLICY_TRUST_PATHS for path in paths)
    # CI-only changes need no image, but cannot self-authorize the source-only
    # PR fast path when runtime content changes alongside the policy boundary.
    require_pr_image = risk or (runtime and trust_changed)
    return {
        "runtime_changed": runtime,
        "pr_image_validation_required": require_pr_image,
        "image_pipeline_required": runtime and (event_name != "pull_request" or require_pr_image),
    }


@dataclass(frozen=True)
class QualityDecision:
    reuse_pr_quality: bool = False
    reason: str = "Full Quality is the default."
    pr_number: int | None = None
    reviewed_head: str | None = None
    merge_sha: str | None = None
    run_id: int | None = None
    base_sha: str | None = None
    tree_sha: str | None = None


def _sha(value: str) -> str:
    if not isinstance(value, str) or not re.fullmatch(r"[0-9a-f]{40}", value):
        raise ValueError("Invalid Git SHA")
    return value


def _positive_int(value: int) -> int:
    if type(value) is not int or value <= 0:
        raise ValueError("Invalid GitHub identity")
    return value


def _time(value: str) -> datetime:
    result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    if result.tzinfo is None:
        raise ValueError("Timestamp must include its timezone")
    return result


def quality_reuse(event_name: str, ref: str, sha: str, repository: str,
                  evidence: dict) -> QualityDecision:
    """Allow reuse only for complete, exact, pre-merge PR proof; malformed data denies."""
    def deny(reason):
        return QualityDecision(reason=reason)
    if event_name != "push" or ref != "refs/heads/main":
        return deny("Only a main push can reuse PR Quality.")
    try:
        _sha(sha)
        if evidence.get("error"):
            return deny("Evidence lookup failed; run full Quality.")
        commit = evidence["commit"]
        parents = commit["parents"]
        if commit["sha"] != sha or len(parents) != 2:
            return deny("Not a normal two-parent merge.")
        prs = evidence["merged_prs"]
        if len(prs) != 1:
            return deny("Merged PR association is missing or ambiguous.")
        pr = prs[0]
        number = _positive_int(pr["number"])
        base, head = _sha(pr["base"]["sha"]), _sha(pr["head"]["sha"])
        if not (pr["state"] == "closed" and pr["merged"] is True
                and pr["base"]["ref"] == "main"
                and pr["base"]["repo"]["full_name"] == repository
                and pr["merge_commit_sha"] == sha):
            return deny("PR does not own this main merge.")
        if parents != [{"sha": base}, {"sha": head}]:
            return deny("Merge parents do not exactly match PR base/head.")
        reviewed = evidence["reviewed_commit"]
        tree = _sha(commit["tree"]["sha"])
        if reviewed["sha"] != head or tree != _sha(reviewed["tree"]["sha"]):
            return deny("Reviewed and landed Git trees differ.")
        paths = evidence["changed_paths"]
        if not isinstance(paths, list) or not paths or not all(isinstance(p, str) for p in paths):
            return deny("PR changed-path evidence is incomplete.")
        if any(p in {QUALITY_WORKFLOW, *POLICY_PATHS} for p in paths):
            return deny("Quality workflow/policy changes cannot self-certify reuse.")
        merged_at = _time(pr["merged_at"])
        for run in evidence["quality_runs"]:
            if not (run["name"] == "Customer Web Quality" and run["path"] == QUALITY_WORKFLOW
                    and run["event"] == "pull_request" and run["head_sha"] == head
                    and run["status"] == "completed" and run["conclusion"] == "success"):
                continue
            # updated_at is conservative: even a later metadata update denies reuse.
            if _time(run["updated_at"]) >= merged_at:
                continue
            proof = run.get("pr_proof")
            expected = {
                "repository": repository, "pr_number": number,
                "base_sha": base, "head_sha": head,
                "run_id": _positive_int(run["id"]),
                "run_attempt": _positive_int(run["run_attempt"]),
            }
            # A run-bound artifact records the event PR identity. A same-head run
            # from another PR is not proof, even when REST pull_requests is empty.
            if proof != expected:
                continue
            return QualityDecision(True, "Verified pre-merge PR Quality and identical tree.",
                                   number, head, sha, run["id"], base, tree)
        return deny("No successful pre-merge exact-PR/head Quality proof.")
    except (KeyError, TypeError, ValueError, AttributeError):
        return deny("Malformed or incomplete evidence; run full Quality.")


def git(*args: str) -> str:
    return subprocess.check_output(["git", *args]).decode("utf-8", errors="surrogateescape").rstrip("\n")


def _ensure_commit(sha: str) -> None:
    _sha(sha)
    if subprocess.run(["git", "cat-file", "-e", f"{sha}^{{commit}}"],
                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL).returncode:
        git("fetch", "--no-tags", "--depth=1", "origin", sha)


def changed_paths(event_name: str, event: dict, sha: str) -> tuple[list[str], str]:
    if event_name == "workflow_dispatch":
        return [], "Manual execution always runs the full image pipeline."
    if event_name == "pull_request":
        base, head = event["pull_request"]["base"]["sha"], event["pull_request"]["head"]["sha"]
        _ensure_commit(base)
        _ensure_commit(head)
        depth = 32
        while True:
            common = subprocess.run(["git", "merge-base", base, head], capture_output=True, text=True)
            if common.returncode == 0:
                base = common.stdout.strip()
                break
            if git("rev-parse", "--is-shallow-repository") != "true":
                raise RuntimeError("Cannot determine the PR merge base")
            git("fetch", "--no-tags", f"--deepen={depth}", "origin", base, head)
            depth *= 2
    elif event_name == "push":
        base, head = event["before"], sha
        _ensure_commit(head)
        if base == "0" * 40:
            base = subprocess.check_output(["git", "hash-object", "-t", "tree", "--stdin"], input=b"").decode().strip()
        else:
            _ensure_commit(base)
    else:
        raise ValueError("Unsupported change-range event")
    paths = [p for p in git("diff", "--no-renames", "--name-only", "-z", base, head).split("\0") if p]
    return paths, f"Compared {base} -> {head}; evaluated {len(paths)} changed paths."


class _NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class GitHubEvidence:
    """Read-only API retrieval; any missing/failed lookup falls back to full Quality."""

    def __init__(self, repository: str, token: str):
        if not re.fullmatch(r"[\w.-]+/[\w.-]+", repository) or not token:
            raise ValueError("Repository/token unavailable")
        self.root = f"https://api.github.com/repos/{repository}"
        self.headers = {"Authorization": f"Bearer {token}", "Accept": "application/vnd.github+json",
                        "X-GitHub-Api-Version": "2022-11-28"}

    def get(self, path: str):
        with urlopen(Request(self.root + path, headers=self.headers), timeout=20) as response:
            return json.load(response)

    def pages(self, path: str, key: str | None = None) -> list:
        result = []
        for page in range(1, 21):
            data = self.get(path + ("&" if "?" in path else "?") + f"per_page=100&page={page}")
            items = data[key] if key else data
            if not isinstance(items, list):
                raise ValueError("Invalid paginated evidence")
            result.extend(items)
            if len(items) < 100:
                return result
        raise ValueError("Evidence pagination exceeded conservative limit")

    def proof(self, run: dict) -> dict | None:
        name = f"customer-web-quality-proof-{run['id']}-{run['run_attempt']}"
        artifacts = self.pages(f"/actions/runs/{run['id']}/artifacts?{urlencode({'name': name})}", "artifacts")
        artifacts = [a for a in artifacts if a["name"] == name and a["expired"] is False]
        if len(artifacts) != 1:
            return None
        artifact = artifacts[0]
        if artifact["workflow_run"]["id"] != run["id"]:
            raise ValueError("Artifact belongs to another run")
        request = Request(self.root + f"/actions/artifacts/{_positive_int(artifact['id'])}/zip", headers=self.headers)
        try:
            response = build_opener(_NoRedirect()).open(request, timeout=20)
        except HTTPError as error:
            if error.code != 302:
                raise
            location = error.headers["Location"]
            if urlparse(location).scheme != "https":
                raise ValueError("Insecure artifact download")
            # Do not forward the GitHub token to the signed storage redirect.
            response = urlopen(location, timeout=20)
        with response:
            data = response.read(1_048_577)
        if len(data) > 1_048_576:
            raise ValueError("Oversized proof artifact")
        with zipfile.ZipFile(io.BytesIO(data)) as archive:
            entry = archive.getinfo("quality-proof.json")
            if entry.file_size > 65_536:
                raise ValueError("Oversized proof document")
            return json.loads(archive.read(entry))


def collect_quality_evidence(api: GitHubEvidence, sha: str) -> dict:
    raw_commit = api.get(f"/git/commits/{_sha(sha)}")
    commit = {"sha": raw_commit["sha"], "tree": raw_commit["tree"],
              "parents": [{"sha": p["sha"]} for p in raw_commit["parents"]]}
    if len(commit["parents"]) != 2:
        return {"commit": commit}
    associated = api.pages(f"/commits/{sha}/pulls")
    merged = [pr for pr in associated if pr.get("merged_at")]
    if len(merged) != 1:
        return {"commit": commit, "merged_prs": merged}
    pr = api.get(f"/pulls/{_positive_int(merged[0]['number'])}")
    files = api.pages(f"/pulls/{pr['number']}/files")
    if len(files) != pr["changed_files"]:
        raise ValueError("Incomplete PR file list")
    paths = [p for file in files for p in (file["filename"], file.get("previous_filename")) if p]
    head = _sha(pr["head"]["sha"])
    evidence = {"commit": commit, "merged_prs": [pr], "changed_paths": paths,
                "reviewed_commit": api.get(f"/git/commits/{head}"), "quality_runs": []}
    if any(path in {QUALITY_WORKFLOW, *POLICY_PATHS} for path in paths):
        return evidence
    runs = api.pages(f"/actions/workflows/customer-web-quality.yml/runs?{urlencode({'event': 'pull_request', 'head_sha': head})}", "workflow_runs")
    for run in runs:
        if run["status"] == "completed" and run["conclusion"] == "success":
            run["pr_proof"] = api.proof(run)
    return {**evidence, "quality_runs": runs}


def quality_from_environment(environ: dict, api_factory=GitHubEvidence) -> QualityDecision:
    event_name, ref = environ.get("GITHUB_EVENT_NAME"), environ.get("GITHUB_REF")
    if event_name != "push" or ref != "refs/heads/main":
        return QualityDecision(reason="PR/manual events run the complete Quality suite.")
    try:
        repository, sha = environ["GITHUB_REPOSITORY"], environ["GITHUB_SHA"]
        api = api_factory(repository, environ["GH_TOKEN"])
        evidence = collect_quality_evidence(api, sha)
        return quality_reuse(event_name, ref, sha, repository, evidence)
    except Exception as error:
        # Network, permissions, parsing and graph errors can never authorize a skip.
        return QualityDecision(reason=f"Evidence unavailable ({type(error).__name__}); run full Quality.")


def pr_proof(environ: dict, event: dict) -> dict:
    if environ["GITHUB_EVENT_NAME"] != "pull_request":
        raise ValueError("Only PR Quality may produce a PR proof")
    pr = event["pull_request"]
    return {"repository": environ["GITHUB_REPOSITORY"], "pr_number": _positive_int(pr["number"]),
            "base_sha": _sha(pr["base"]["sha"]), "head_sha": _sha(pr["head"]["sha"]),
            "run_id": _positive_int(int(environ["GITHUB_RUN_ID"])),
            "run_attempt": _positive_int(int(environ["GITHUB_RUN_ATTEMPT"]))}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["quality", "image", "write-pr-proof"])
    parser.add_argument("--proof-directory", type=Path)
    args = parser.parse_args()
    if args.command == "quality":
        decision = quality_from_environment(os.environ)
        outputs = {"reuse_pr_quality": decision.reuse_pr_quality}
        summary = "## Customer Web Quality proof\n\n" + decision.reason + "\n\n"
        if decision.reuse_pr_quality:
            summary += (f"- Merged PR: #{decision.pr_number}\n- Reviewed head: `{decision.reviewed_head}`\n"
                        f"- Merge SHA: `{decision.merge_sha}`\n- PR Quality run: `{decision.run_id}`\n"
                        f"- Parent 1 = PR base: `{decision.base_sha}`\n- Parent 2 = PR head: verified\n"
                        f"- Identical Git tree: `{decision.tree_sha}`\n- reused_pr_quality=true\n")
        else:
            summary += "reuse_pr_quality=false; complete Quality suite required.\n"
        print(json.dumps(asdict(decision)))
    else:
        event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
        if args.command == "write-pr-proof":
            args.proof_directory.mkdir(parents=True, exist_ok=True)
            (args.proof_directory / "quality-proof.json").write_text(
                json.dumps(pr_proof(os.environ, event)), encoding="utf-8")
            return
        paths, reason = changed_paths(os.environ["GITHUB_EVENT_NAME"], event, os.environ["GITHUB_SHA"])
        outputs = image_policy(os.environ["GITHUB_EVENT_NAME"], paths)
        for path in paths:
            print(f"runtime_relevant={str(runtime_relevant(path)).lower()} "
                  f"image_risk={str(image_risk(path)).lower()} path={json.dumps(path)}")
        print(reason)
        summary = f"## Customer Web image policy\n\n{reason}\n\n"
    for name, value in outputs.items():
        summary += f"{name}={str(value).lower()}\n\n"
        print(f"{name}={str(value).lower()}")
    with open(os.environ["GITHUB_STEP_SUMMARY"], "a", encoding="utf-8") as stream:
        stream.write(summary)
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as stream:
        for name, value in outputs.items():
            stream.write(f"{name}={str(value).lower()}\n")


if __name__ == "__main__":
    main()
