#!/usr/bin/env python3
"""Read-only audit of stacked open PRs against the exact main-branch file tree.

A same-byte result is a content observation, not permission to close a PR.
"""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


def inspect_files(files: list[dict], main_blobs: dict[str, str]) -> dict[str, object]:
    """Compare the complete PR head file bytes to the selected main snapshot."""
    identical = []
    different = []
    missing = []
    for f in files:
        name = f["filename"]
        sha = f.get("sha")
        target = main_blobs.get(name)
        if target is None:
            missing.append(name)
        elif target == sha and sha is not None:
            identical.append(name)
        else:
            different.append(name)
    return {
        "total": len(files),
        "identical": identical,
        "different": different,
        "missing": missing,
    }


def classify(info: dict, counts: dict) -> str:
    if counts["missing"]:
        return "Nieuwe bestanden, afzonderlijk beoordelen"
    if counts["different"]:
        return "Afwijkende inhoud, vergelijken"
    if counts["total"] == 0:
        return "Geen gewijzigde bestanden zichtbaar"
    return "Bestanden gelijk aan main, verifieer bedoeling"


def github_json(url: str, token: str) -> object:
    req = Request(url, headers={
        "Accept": "application/vnd.github+json",
        "User-Agent": "EAIwork-pr-audit/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
        "Authorization": f"Bearer {token}",
    })
    try:
        with urlopen(req, timeout=30) as response:
            return json.load(response)
    except HTTPError as exc:
        raise RuntimeError(f"GitHub API returned HTTP {exc.code} for {url.split('?')[0]}") from exc


def paged(api: str, token: str) -> list[dict]:
    items: list[dict] = []
    for page in range(1, 30):
        value = github_json(f"{api}{'&' if '?' in api else '?'}{urlencode({'per_page': 100, 'page': page})}", token)
        if not isinstance(value, list):
            raise RuntimeError("Expected a list from GitHub")
        items.extend(value)
        if len(value) < 100:
            return items
    raise RuntimeError("Pagination limit reached; refusing partial inventory")


def audit(repo: str, branch: str, token: str) -> dict:
    if "/" not in repo or repo.count("/") != 1:
        raise ValueError("Repository must use owner/name")
    api = f"https://api.github.com/repos/{repo}"
    branch_info = github_json(f"{api}/branches/{branch}", token)
    head_sha = branch_info["commit"]["sha"]
    tree = github_json(f"{api}/git/trees/{head_sha}?recursive=1", token)
    if tree.get("truncated"):
        raise RuntimeError("Main tree is truncated; results would be misleading")
    main_blobs = {f["path"]: f["sha"] for f in tree["tree"] if f["type"] == "blob"}
    prs = paged(f"{api}/pulls?state=open", token)
    entries = []
    for pr in prs:
        number = pr["number"]
        changes = paged(f"{api}/pulls/{number}/files", token)
        counts = inspect_files(changes, main_blobs)
        entries.append({
            "number": number,
            "title": pr["title"],
            "url": pr["html_url"],
            "draft": pr["draft"],
            "base": pr["base"]["ref"],
            "head": pr["head"]["ref"],
            "head_sha": pr["head"]["sha"],
            "files": counts,
            "group": classify(pr, counts),
        })
    return {"repo": repo, "main_sha": head_sha, "prs": sorted(entries, key=lambda item: item["number"])}


def markdown(report: dict) -> str:
    entries = report["prs"]
    out = [
        "# Open PR's tegenover main",
        "",
        f"Repository: \`{report['repo']}\`",
        f"Momentopname main: \`{report['main_sha']}\`",
        f"Open PR's: **{len(entries)}**",
        "",
        "Dit is een bestandsvergelijking, geen oordeel dat wijzigingen correct, getest of overbodig zijn.",
        "Een PR wordt nooit automatisch gesloten of samengevoegd.",
        "",
        "| PR | Doelbranch | Status | Gelijk | Anders | Ontbreekt |",
        "|---|---|---|---:|---:|---:|",
    ]
    for pr in entries:
        c = pr["files"]
        title = pr["title"].replace("|", "/").replace("\n", " ")
        out.append(
            f"| [#{pr['number']}]({pr['url']}) {title} | \`{pr['base']}\` | "
            f"{'Concept' if pr['draft'] else 'Review'} | {len(c['identical'])} | "
            f"{len(c['different'])} | {len(c['missing'])} |"
        )
    out.extend(["", "## Wat nog expliciet bekeken moet worden", ""])
    for pr in entries:
        c = pr["files"]
        if not (c["missing"] or c["different"]):
            continue
        out.extend([
            f"### [PR #{pr['number']}]({pr['url']})",
            f"{pr['group']}. Base: \`{pr['base']}\`, head: \`{pr['head_sha']}\`.",
            "",
        ])
        if c["missing"]:
            out.append("Alleen in deze PR-head: " + ", ".join(f"\`{p}\`" for p in c["missing"]))
        if c["different"]:
            out.append("Andere inhoud dan main: " + ", ".join(f"\`{p}\`" for p in c["different"]))
        out.append("")
    return "\n".join(out) + "\n"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--repo", default=os.environ.get("GITHUB_REPOSITORY", "E-AI-MODEL/EAIwork-"))
    parser.add_argument("--branch", default="main")
    parser.add_argument("--output", type=Path, default=Path("pr-backlog-audit.md"))
    args = parser.parse_args()
    token = os.environ.get("GITHUB_TOKEN")
    if not token:
        raise SystemExit("GITHUB_TOKEN is required for a read-only GitHub audit")
    report = audit(args.repo, args.branch, token)
    args.output.write_text(markdown(report), encoding="utf-8")
    args.output.with_suffix(".json").write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Open PR's: {len(report['prs'])}")
    for pr in report["prs"]:
        print(f"#{pr['number']} {pr['group']}: "
              f"{len(pr['files']['identical'])} gelijk, "
              f"{len(pr['files']['different'])} anders, "
              f"{len(pr['files']['missing'])} ontbreekt")
    print(f"Volledig verslag: {args.output}")


if __name__ == "__main__":
    main()
