#!/usr/bin/env python3
"""Breeze — release helper.

Shipping a build is an INSERT, not a redeploy. This reads whatever
electron-builder produced, computes the SHA-256 and size of each installer,
and prints the SQL to paste into the Supabase editor plus the exact upload
targets for the storage bucket.
"""
import argparse
import hashlib
import pathlib
import sys

PATTERNS = [
    ("*-arm64.dmg",       "macos-arm"),
    ("*-x64.dmg",         "macos-x64"),
    ("*-arm64-mac.zip",   "macos-arm"),
    ("*-x64-mac.zip",     "macos-x64"),
    ("*Setup*.exe",       "windows-x64"),
    ("*.AppImage",        "linux-x64"),
    ("*.deb",             "linux-x64"),
]

DIST = pathlib.Path(__file__).resolve().parent / "shell" / "dist"

def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("version", help="e.g. 1.0")
    ap.add_argument("codename", help="e.g. McCloskey")
    ap.add_argument("--project", required=True, help="Supabase project ref")
    ap.add_argument("--channel", default="stable", choices=["stable", "beta"])
    ap.add_argument("--dist", default=str(DIST), help="where the installers are")
    args = ap.parse_args()

    dist = pathlib.Path(args.dist)
    if not dist.is_dir():
        sys.exit(f"No such directory: {dist}\nRun `cd shell && npm run dist` first.")

    found, extras, claimed, taken = [], [], set(), set()
    for pattern, platform in PATTERNS:
        for f in sorted(dist.glob(pattern)):
            if f in claimed:
                continue
            claimed.add(f)
            if platform in taken:
                extras.append((f, platform))
            else:
                taken.add(platform)
                found.append((f, platform))

    if not found:
        sys.exit(f"No installers in {dist}. Run `cd shell && npm run dist` first.")

    unmatched = [f for f in dist.iterdir()
                 if f.is_file() and f not in claimed
                 and f.suffix in {".dmg", ".exe", ".AppImage", ".deb", ".zip"}]

    base = f"https://{args.project}.supabase.co/storage/v1/object/public/releases"

    print("\n── 1. Upload these to the `releases` storage bucket ──\n")
    for f, platform in found:
        print(f"   {f.name}   ({f.stat().st_size / 1048576:.1f} MB)  → {platform}")
    for f, platform in extras:
        print(f"   {f.name}   ({f.stat().st_size / 1048576:.1f} MB)  → {platform}, alternative format")
    if unmatched:
        print("\n   Not recognised, and therefore NOT in the SQL below:")
        for f in unmatched:
            print(f"   {f.name}")

    print("\n── 2. Run this in the Supabase SQL editor ──\n")
    print("insert into public.releases")
    print("  (version, codename, channel, platform, file_url, file_size, sha256, is_published)")
    print("values")
    rows = []
    for f, platform in found:
        rows.append(
            f"  ('{args.version}','{args.codename}','{args.channel}','{platform}',\n"
            f"   '{base}/{f.name}',\n"
            f"   {f.stat().st_size},'{sha256(f)}', true)"
        )
    print(",\n".join(rows))
    print("on conflict (version, channel, platform) do update set")
    print("  file_url = excluded.file_url, file_size = excluded.file_size,")
    print("  sha256 = excluded.sha256, is_published = excluded.is_published;")

    print("\n── 3. Publish the checksums with the release ──\n")
    for f, _ in found:
        print(f"   {sha256(f)}  {f.name}")

if __name__ == "__main__":
    main()
