#!/usr/bin/env python3
# Migrate existing puzzles to a single author for those without metadata.

from __future__ import annotations

import argparse
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from game.db import (  # noqa: E402
    init_db,
    upsert_user,
    get_puzzle_author_id,
    touch_puzzle_meta,
)
from game.puzzles import PUZZLE_DIR, load_puzzles  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Assign existing puzzles without author metadata to a nickname."
    )
    parser.add_argument("--nickname", default="Admin", help="Target nickname (default: Admin)")
    args = parser.parse_args()

    init_db()
    user = upsert_user(args.nickname)
    puzzles = load_puzzles(PUZZLE_DIR)

    assigned = 0
    skipped = 0
    for puzzle in puzzles:
        puzzle_id = puzzle.get("id")
        if not puzzle_id:
            continue
        author_id = get_puzzle_author_id(puzzle_id)
        if author_id:
            skipped += 1
            continue
        touch_puzzle_meta(puzzle_id, int(user["id"]))
        assigned += 1

    print(f"Done. assigned={assigned} skipped={skipped} nickname={args.nickname}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
