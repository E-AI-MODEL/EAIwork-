#!/usr/bin/env python3
"""Build and verify a review-only EAIwork local demo ZIP with a byte manifest."""
import hashlib
import json
import pathlib
import sys
import zipfile

ROOT = pathlib.Path(__file__).resolve().parents[1]
OUT = ROOT / "dist" / "eaiwork-local-demo.zip"
FIXED = (2026, 1, 1, 0, 0, 0)
INCLUDE = ("package.json", "LICENSE", "README.md", "scripts/local-demo.ts",
           "scripts/local-text-executor.ts", "scripts/local-ollama.ts",
           "scripts/local-profile.ts")
DIRECTORIES = ("packages", "packs", "prototypes/dashboard")
MAX_FILES = 400
MAX_FILE_SIZE = 2 * 1024 * 1024
MANIFEST = "DISTRIBUTION-MANIFEST.json"


def collected():
    paths = [ROOT / name for name in INCLUDE]
    for directory in DIRECTORIES:
        paths.extend(p for p in (ROOT / directory).rglob("*") if p.is_file())
    result = {}
    for path in paths:
        if path.is_symlink() or not path.is_file() or not path.resolve().is_relative_to(ROOT):
            raise ValueError("unsafe distribution path: " + str(path))
        name = path.relative_to(ROOT).as_posix()
        if name.startswith(".") or "/." in name or name in result:
            raise ValueError("unsafe or duplicate distribution path: " + name)
        data = path.read_bytes()
        if len(data) > MAX_FILE_SIZE:
            raise ValueError("distribution member too large: " + name)
        result[name] = data
    if not result or len(result) > MAX_FILES:
        raise ValueError("distribution file count out of range")
    return dict(sorted(result.items()))


def write_member(archive, name, content):
    info = zipfile.ZipInfo(name, FIXED)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    archive.writestr(info, content, compresslevel=9)


def build():
    files = collected()
    license_bytes = files["LICENSE"]
    if not (license_bytes.startswith(b"# PolyForm Noncommercial License 1.0.0") and
            b"Required Notice: Copyright 2026 H. Visser / E-AI-MODEL." in license_bytes):
        raise ValueError("noncommercial repository license missing or unexpected")
    manifest = {
        "schema": "eaiwork-local-demo-v1",
        "purpose": "local-demo-only",
        "requires": "Node.js >=22.18",
        "start": "npm run demo:dashboard",
        "publicationApproved": False,
        "licenseReview": "repo-license-present",
        "files": {name: {"sha256": hashlib.sha256(data).hexdigest(),
                         "bytes": len(data)} for name, data in files.items()},
    }
    OUT.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(OUT, "w") as archive:
        for name, data in files.items():
            write_member(archive, name, data)
        write_member(archive, MANIFEST,
                     (json.dumps(manifest, sort_keys=True, indent=2) + "\n").encode())
    verify(OUT)
    print(f"Built {OUT.name} ({OUT.stat().st_size} bytes); "
          f"SHA-256 {hashlib.sha256(OUT.read_bytes()).hexdigest()}")


def verify(archive_path):
    with zipfile.ZipFile(archive_path, "r") as archive:
        members = archive.infolist()
        names = [item.filename for item in members]
        if len(names) != len(set(names)) or len(names) > MAX_FILES + 1:
            raise ValueError("duplicate or excessive ZIP entries")
        if MANIFEST not in names:
            raise ValueError("manifest missing")
        if any(name.startswith("/") or "\\" in name or
               any(part in ("", ".", "..") for part in name.split("/"))
               for name in names):
            raise ValueError("unsafe ZIP path")
        manifest = json.loads(archive.read(MANIFEST))
        if (manifest.get("schema") != "eaiwork-local-demo-v1" or
                manifest.get("publicationApproved") is not False or
                manifest.get("purpose") != "local-demo-only" or
                manifest.get("licenseReview") != "repo-license-present"):
            raise ValueError("wrong distribution manifest")
        records = manifest.get("files")
        if not isinstance(records, dict) or set(records) != set(names) - {MANIFEST}:
            raise ValueError("manifest coverage mismatch")
        for item in members:
            if (item.is_dir() or item.file_size > MAX_FILE_SIZE or
                    ((item.external_attr >> 16) & 0o170000) == 0o120000):
                raise ValueError("unsafe distribution member")
            if item.filename == MANIFEST:
                continue
            actual = archive.read(item)
            expected = records[item.filename]
            if (len(actual) != expected["bytes"] or
                    hashlib.sha256(actual).hexdigest() != expected["sha256"]):
                raise ValueError("member checksum mismatch: " + item.filename)
    print("Distribution manifest and all member bytes verified")


if __name__ == "__main__":
    if len(sys.argv) == 2 and sys.argv[1] == "build":
        build()
    elif len(sys.argv) == 3 and sys.argv[1] == "verify":
        verify(pathlib.Path(sys.argv[2]))
    else:
        sys.exit("Usage: python3 scripts/build-distribution.py build|verify <zip>")
