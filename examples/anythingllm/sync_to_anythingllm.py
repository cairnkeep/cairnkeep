#!/usr/bin/env python3
"""
Multi-project incremental sync into AnythingLLM.

Each project repo gets its own AnythingLLM workspace. All projects are
configured in anythingllm-projects.json alongside this script.

This is a reference example wired to cairnkeep's `domain_knowledge_sync`
tool via the `CAIRN_ANYTHINGLLM_SYNC_SCRIPT` env var. Copy it, adjust the
config, and point cairnkeep at your copy. See ../../docs/domain-knowledge.md.

Usage:
    # Sync all configured projects (normal workflow after git pull):
    python3 sync_to_anythingllm.py

    # Only sync one project:
    python3 sync_to_anythingllm.py --project my-project

    # Preview without making changes:
    python3 sync_to_anythingllm.py --dry-run

    # First-time upload for a new project:
    python3 sync_to_anythingllm.py --full --project my-project

    # Replace stale embedded workspace docs, then upload current configured docs:
    python3 sync_to_anythingllm.py --replace --project my-project

    # Rebuild state from existing store (recovery, no re-upload):
    python3 sync_to_anythingllm.py --rebuild-state --project my-project

    # List all configured projects and file counts:
    python3 sync_to_anythingllm.py --list

Config:  anythingllm-projects.json   (alongside this script; see the .example)
State:   .anythingllm-sync.json      (git-ignored, machine-local)

State file format:
    {
      "project-a": { "docs/foo.md": {"location": "custom-documents/foo-uuid.json", "sha256": "..."} },
      "project-b": { ... },
      ...
    }
"""

import argparse
import fnmatch
import hashlib
import json
import os
import sys
import time
from pathlib import Path

import requests

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

BASE_URL = f"{os.environ.get('ANYTHINGLLM_BASE_URL', 'http://localhost:3001').rstrip('/')}/api/v1"
API_KEY = os.environ.get("ANYTHINGLLM_API_KEY", "")

SCRIPT_DIR = Path(__file__).parent
CONFIG_FILE = SCRIPT_DIR / "anythingllm-projects.json"
STATE_FILE = SCRIPT_DIR / ".anythingllm-sync.json"

HEADERS = {"Authorization": f"Bearer {API_KEY}"}
JSON_HEADERS = {**HEADERS, "Content-Type": "application/json"}

EMBED_BATCH_SIZE = 5
EMBED_TIMEOUT = 600  # seconds per embed batch

WORKSPACE_SYSTEM_PROMPT = (
    "You are an assistant for the {display_name} documentation. "
    "Answer the user question using ONLY the context documents provided below. "
    "Do not rely on prior knowledge or make assumptions beyond what is explicitly "
    "stated in the documents.\n\n"
    "Rules:\n"
    "- If the answer is clearly present in the context, provide a precise and structured answer.\n"
    "- If the context does not contain enough information to answer confidently, respond: "
    '"This information is not available in the provided documentation."\n'
    "- Never fabricate component names, port numbers, version numbers, or procedures "
    "not in the context.\n"
    "- Cite which document or section your answer comes from when possible."
)


def require_api_key() -> None:
    if API_KEY:
        return
    print("Error: ANYTHINGLLM_API_KEY is not set.")
    sys.exit(1)

# ---------------------------------------------------------------------------
# Config loading
# ---------------------------------------------------------------------------

def load_config() -> list[dict]:
    if not CONFIG_FILE.exists():
        print(f"Error: Config file not found: {CONFIG_FILE}")
        sys.exit(1)
    data = json.loads(CONFIG_FILE.read_text())
    return data["projects"]


# ---------------------------------------------------------------------------
# State file helpers
# ---------------------------------------------------------------------------

def load_state() -> dict:
    """
    Load full state: {project_slug: {relative_path: {location, sha256}}}

    Automatically migrates a legacy flat (single-project) state file into the
    nested multi-project format, keyed under the "default" slug.
    """
    if not STATE_FILE.exists():
        return {}
    raw = json.loads(STATE_FILE.read_text())
    if not raw:
        return {}
    # Detect old flat format: top-level values are {location, sha256} dicts
    first_val = next(iter(raw.values()))
    if isinstance(first_val, dict) and "location" in first_val:
        print("[INFO] Migrating state file from flat to multi-project format...")
        return {"default": raw}
    return raw


def save_state(state: dict) -> None:
    STATE_FILE.write_text(json.dumps(state, indent=2))


def file_sha256(path: Path) -> str:
    h = hashlib.sha256()
    h.update(path.read_bytes())
    return h.hexdigest()


# ---------------------------------------------------------------------------
# File collection
# ---------------------------------------------------------------------------

def is_excluded(rel: str, excludes: list[str]) -> bool:
    """Return True if the relative path matches any exclude pattern."""
    name = os.path.basename(rel)
    for exc in excludes:
        if fnmatch.fnmatch(rel, exc):
            return True
        if fnmatch.fnmatch(name, exc):
            return True
    return False


def collect_files(project: dict) -> dict[str, Path]:
    """
    Return {relative_path_str: absolute_Path} for all files matching the
    project's include patterns minus any exclude patterns. Paths are relative
    to the project root.
    """
    root = Path(project["path"])
    patterns = project.get("patterns", ["docs/**/*.md"])
    excludes = project.get("exclude_patterns", [])

    result: dict[str, Path] = {}
    for pattern in patterns:
        for p in root.glob(pattern):
            if not p.is_file():
                continue
            rel = str(p.relative_to(root))
            if not is_excluded(rel, excludes):
                result[rel] = p
    return result


# ---------------------------------------------------------------------------
# AnythingLLM API helpers
# ---------------------------------------------------------------------------

def ensure_workspace(slug: str, display_name: str) -> str:
    """
    Create the workspace if it doesn't exist, then apply standard RAG settings.
    Returns the actual workspace slug to use for all subsequent API calls,
    or empty string on failure.

    Uses the project slug as the workspace name so AnythingLLM generates
    a matching slug (e.g. name='my-project' -> slug='my-project').
    """
    resp = requests.get(f"{BASE_URL}/workspaces", headers=HEADERS, timeout=10)
    if resp.status_code == 200:
        for ws in resp.json().get("workspaces", []):
            if ws["slug"] == slug:
                update_workspace_settings(slug, display_name)
                return slug

    # Create -- use slug as name so AnythingLLM generates the exact slug we want
    resp = requests.post(
        f"{BASE_URL}/workspace/new",
        headers=JSON_HEADERS,
        data=json.dumps({"name": slug}),
        timeout=10,
    )
    if resp.status_code != 200:
        print(f"  [WARN] Could not create workspace '{slug}': {resp.status_code} {resp.text[:200]}")
        return ""

    actual_slug = resp.json().get("workspace", {}).get("slug", slug)

    update_workspace_settings(actual_slug, display_name)
    print(f"  Created workspace: {actual_slug}")
    return actual_slug


def update_workspace_settings(slug: str, display_name: str) -> None:
    """Apply standard RAG settings and project-specific system prompt."""
    requests.post(
        f"{BASE_URL}/workspace/{slug}/update",
        headers=JSON_HEADERS,
        data=json.dumps({
            "openAiTemp": 0,
            "topN": 6,
            "similarityThreshold": 0.20,
            "openAiPrompt": WORKSPACE_SYSTEM_PROMPT.format(display_name=display_name),
            "queryRefusalResponse": f"This information is not available in the provided {display_name} documentation.",
            "chatMode": "automatic",
        }),
        timeout=10,
    )


def upload_file(filepath: Path) -> str | None:
    """Upload a single markdown file. Returns the location string or None."""
    with open(filepath, "rb") as f:
        resp = requests.post(
            f"{BASE_URL}/document/upload",
            headers=HEADERS,
            files={"file": (filepath.name, f, "text/markdown")},
            timeout=60,
        )
    if resp.status_code == 200:
        docs = resp.json().get("documents", [])
        if docs:
            return docs[0].get("location")
    print(f"  [WARN] Upload failed for {filepath.name}: {resp.status_code} {resp.text[:200]}")
    return None


def embed_locations(slug: str, locations: list[str]) -> bool:
    """Embed document locations into a workspace in batches."""
    for i in range(0, len(locations), EMBED_BATCH_SIZE):
        batch = locations[i: i + EMBED_BATCH_SIZE]
        resp = requests.post(
            f"{BASE_URL}/workspace/{slug}/update-embeddings",
            headers=JSON_HEADERS,
            data=json.dumps({"adds": batch, "deletes": []}),
            timeout=EMBED_TIMEOUT,
        )
        if resp.status_code != 200:
            print(f"  [WARN] Embed failed: {resp.status_code} {resp.text[:200]}")
            return False
        time.sleep(1)
    return True


def unembed_locations(slug: str, locations: list[str]) -> bool:
    """Remove document locations from a workspace (un-embed only, keeps store)."""
    if not locations:
        return True
    resp = requests.post(
        f"{BASE_URL}/workspace/{slug}/update-embeddings",
        headers=JSON_HEADERS,
        data=json.dumps({"adds": [], "deletes": locations}),
        timeout=60,
    )
    return resp.status_code == 200


def get_workspace_locations(slug: str) -> list[str]:
    """Return document locations currently embedded in the workspace."""
    resp = requests.get(f"{BASE_URL}/workspace/{slug}", headers=HEADERS, timeout=30)
    if resp.status_code != 200:
        print(f"  [WARN] Could not inspect workspace '{slug}': {resp.status_code} {resp.text[:200]}")
        return []

    data = resp.json()
    workspaces = data.get("workspace", [])
    workspace = workspaces[0] if workspaces else {}
    return [
        doc.get("docpath", "")
        for doc in workspace.get("documents", [])
        if doc.get("docpath")
    ]


def delete_from_store(locations: list[str]) -> bool:
    """Permanently delete documents from the global document store."""
    if not locations:
        return True
    resp = requests.delete(
        f"{BASE_URL}/system/remove-documents",
        headers=JSON_HEADERS,
        data=json.dumps({"names": locations}),
        timeout=60,
    )
    return resp.status_code == 200


# ---------------------------------------------------------------------------
# Diff logic
# ---------------------------------------------------------------------------

def compute_diff(
    project_state: dict, files: dict[str, Path]
) -> tuple[list[str], list[str], list[str]]:
    """Return (added, modified, deleted) lists of relative path strings."""
    added = [rel for rel in files if rel not in project_state]
    deleted = [rel for rel in project_state if rel not in files]
    modified = [
        rel for rel, path in files.items()
        if rel in project_state and file_sha256(path) != project_state[rel].get("sha256")
    ]
    return added, modified, deleted


# ---------------------------------------------------------------------------
# Per-project operations
# ---------------------------------------------------------------------------

def full_sync_project(project: dict, state: dict, dry_run: bool) -> None:
    slug = project["slug"]
    display_name = project.get("display_name", slug)
    files = collect_files(project)

    print(f"\n=== Full sync: {display_name} ({len(files)} files) ===")

    if dry_run:
        for rel in sorted(files):
            print(f"  would upload: {rel}")
        return

    actual_slug = ensure_workspace(slug, display_name)
    if not actual_slug:
        return

    project_state: dict = {}
    locations: list[str] = []

    print("  Uploading...")
    for i, (rel, filepath) in enumerate(sorted(files.items()), 1):
        print(f"  [{i}/{len(files)}] {rel}")
        loc = upload_file(filepath)
        if loc:
            project_state[rel] = {"location": loc, "sha256": file_sha256(filepath)}
            locations.append(loc)
        time.sleep(0.1)

    print(f"  Embedding {len(locations)} docs...")
    ok = embed_locations(actual_slug, locations)
    if not ok:
        print("  [WARN] Some embed batches failed. State saved; retry with --full to re-embed.")

    state[slug] = project_state
    save_state(state)
    print(f"  Done. {len(locations)} docs uploaded to workspace '{actual_slug}'")


def replace_sync_project(project: dict, state: dict, dry_run: bool) -> None:
    """Remove current workspace docs, then full-sync configured project docs."""
    slug = project["slug"]
    display_name = project.get("display_name", slug)
    files = collect_files(project)

    print(f"\n=== Replace sync: {display_name} ({len(files)} files) ===")

    if dry_run:
        print(f"  would remove embedded docs from workspace: {slug}")
        for rel in sorted(files):
            print(f"  would upload: {rel}")
        return

    actual_slug = ensure_workspace(slug, display_name)
    if not actual_slug:
        return

    existing_locations = get_workspace_locations(actual_slug)
    if existing_locations:
        print(f"  Removing {len(existing_locations)} existing embedded doc(s)...")
        unembed_locations(actual_slug, existing_locations)
        delete_from_store(existing_locations)

    state[slug] = {}
    save_state(state)
    full_sync_project(project, state, dry_run=False)


def incremental_sync_project(project: dict, state: dict, dry_run: bool) -> None:
    slug = project["slug"]
    display_name = project.get("display_name", slug)
    actual_slug = slug if dry_run else (ensure_workspace(slug, display_name) or slug)
    project_state = state.get(slug, {})

    if not project_state:
        print(
            f"\n[{display_name}] No sync state found. "
            f"Run --full --project {slug} for initial upload."
        )
        return

    files = collect_files(project)
    added, modified, deleted = compute_diff(project_state, files)

    if not added and not modified and not deleted:
        print(f"[{display_name}] Up to date.")
        return

    print(f"\n=== [{display_name}] Changes: +{len(added)} ~{len(modified)} -{len(deleted)} ===")

    if dry_run:
        for rel in sorted(added):
            print(f"  + {rel}")
        for rel in sorted(modified):
            print(f"  ~ {rel}")
        for rel in sorted(deleted):
            print(f"  - {rel}")
        return

    if deleted:
        old_locs = [project_state[rel]["location"] for rel in deleted if "location" in project_state[rel]]
        unembed_locations(actual_slug, old_locs)
        delete_from_store(old_locs)
        for rel in deleted:
            del project_state[rel]
            print(f"  [DEL] {rel}")
        state[slug] = project_state
        save_state(state)

    if modified:
        old_locs = [project_state[rel]["location"] for rel in modified if "location" in project_state[rel]]
        unembed_locations(actual_slug, old_locs)
        delete_from_store(old_locs)
        new_locs: list[str] = []
        for rel in modified:
            filepath = files[rel]
            print(f"  [MOD] {rel}")
            loc = upload_file(filepath)
            if loc:
                project_state[rel] = {"location": loc, "sha256": file_sha256(filepath)}
                new_locs.append(loc)
            time.sleep(0.1)
        if new_locs:
            embed_locations(actual_slug, new_locs)
        state[slug] = project_state
        save_state(state)

    if added:
        new_locs = []
        for rel in sorted(added):
            filepath = files[rel]
            print(f"  [ADD] {rel}")
            loc = upload_file(filepath)
            if loc:
                project_state[rel] = {"location": loc, "sha256": file_sha256(filepath)}
                new_locs.append(loc)
            time.sleep(0.1)
        if new_locs:
            embed_locations(actual_slug, new_locs)
        state[slug] = project_state
        save_state(state)

    print(f"  Done.")


def rebuild_state_project(project: dict, state: dict) -> None:
    """
    Rebuild state by matching files against documents already in the store.
    Useful for recovery when the state file is lost after docs are already uploaded.
    Note: matches by filename (title); may be ambiguous if two projects share filenames.
    """
    slug = project["slug"]
    display_name = project.get("display_name", slug)

    resp = requests.get(f"{BASE_URL}/documents", headers=HEADERS, timeout=30)
    resp.raise_for_status()

    store_docs: dict[str, dict] = {}
    for folder in resp.json().get("localFiles", {}).get("items", []):
        folder_name = folder.get("name", "")
        for item in folder.get("items", []):
            title = item.get("title", "")
            loc = f"{folder_name}/{item['name']}"
            if title not in store_docs or item.get("published", "") > store_docs[title]["published"]:
                store_docs[title] = {"location": loc, "published": item.get("published", "")}

    files = collect_files(project)
    project_state: dict = {}
    matched = 0
    unmatched: list[str] = []

    for rel, filepath in files.items():
        title = filepath.name
        if title in store_docs:
            project_state[rel] = {
                "location": store_docs[title]["location"],
                "sha256": file_sha256(filepath),
            }
            matched += 1
        else:
            unmatched.append(rel)

    state[slug] = project_state
    save_state(state)
    print(f"[{display_name}] Rebuilt: {matched} matched, {len(unmatched)} unmatched")
    if unmatched:
        for u in unmatched:
            print(f"  unmatched: {u}")


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Multi-project AnythingLLM sync",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=(
            "examples:\n"
            "  sync all projects after git pull:\n"
            "    python3 sync_to_anythingllm.py\n\n"
            "  first-time upload for a new project:\n"
            "    python3 sync_to_anythingllm.py --full --project my-project\n\n"
            "  preview what would change:\n"
            "    python3 sync_to_anythingllm.py --dry-run\n"
        ),
    )
    parser.add_argument(
        "--project", metavar="SLUG",
        help="Only operate on this project (slug from anythingllm-projects.json).",
    )
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--full", action="store_true", help="Full re-upload and re-embed")
    group.add_argument("--replace", action="store_true", help="Remove currently embedded workspace docs, then full re-upload and re-embed")
    group.add_argument("--rebuild-state", action="store_true", help="Rebuild state from existing store (no upload)")
    group.add_argument("--list", action="store_true", help="List configured projects and file counts")
    parser.add_argument("--dry-run", action="store_true", help="Show what would change without doing it")
    args = parser.parse_args()

    projects = load_config()
    slug_map = {p["slug"]: p for p in projects}

    if args.list:
        print(f"{'SLUG':<25} {'FILES':>6}  PATH")
        print("-" * 70)
        for p in projects:
            files = collect_files(p)
            print(f"{p['slug']:<25} {len(files):>6}  {p['path']}")
        return

    require_api_key()

    if args.project and args.project not in slug_map:
        print(f"Error: Unknown project '{args.project}'. Known: {', '.join(slug_map)}")
        sys.exit(1)

    target_projects = [slug_map[args.project]] if args.project else projects
    state = load_state()

    for project in target_projects:
        if args.rebuild_state:
            rebuild_state_project(project, state)
        elif args.replace:
            replace_sync_project(project, state, dry_run=args.dry_run)
        elif args.full:
            full_sync_project(project, state, dry_run=args.dry_run)
        else:
            incremental_sync_project(project, state, dry_run=args.dry_run)


if __name__ == "__main__":
    main()
