"""Server-built folder tree for the Docs explorer.

Kept apart from the store so ``docs.py`` stays a readable size: this is one read
query plus the grouping the browser used to do.
"""

import json

from . import card_docs, db


def tree(per_folder=5, author=None):
    """One compact tree for the explorer: folders, counts, and the first N docs.

    Sending the whole corpus so the browser can build the tree does not scale,
    so the server does the grouping here: every folder reports its recursive
    count and at most ``per_folder`` docs (sorted by name), plus how many more
    it holds. The page then lazily fetches a folder's remainder only when the
    reader asks for it. Content is never included unless asked.
    """
    per_folder = max(1, min(int(per_folder or 5), 100))
    conn = db.get_db()
    sql = "SELECT id, prefix, author, tags, updated_at, length(content) AS size FROM doc"
    args = []
    if author is not None:
        if author == "":
            sql += " WHERE author IS NULL OR author = ''"
        else:
            sql += " WHERE author = ? COLLATE NOCASE"
            args.append(author)
    rows = conn.execute(sql, args).fetchall()
    counts = card_docs.counts_for(conn, [row["prefix"] for row in rows])

    folders = {}  # path -> {"docs": [...], "children": set()}
    root_docs = []

    def folder(path):
        if path not in folders:
            folders[path] = {"docs": [], "children": set()}
        return folders[path]

    for row in rows:
        parts = row["prefix"].split("/")
        name = parts[-1]
        parents = parts[:-1]
        entry = {
            "prefix": row["prefix"],
            "name": name,
            "author": row["author"],
            "tags": json.loads(row["tags"] or "[]"),
            "updated_at": row["updated_at"],
            "size": row["size"],
            "card_count": counts.get(row["prefix"], 0),
        }
        if not parents:
            root_docs.append(entry)
            continue
        for index in range(1, len(parents) + 1):
            child = "/".join(parents[:index])
            folder(child)
            if index > 1:  # the empty string is the root, not a folder
                folder("/".join(parents[: index - 1]))["children"].add(child)
        folder("/".join(parents))["docs"].append(entry)

    def count(path):
        node = folders.get(path) or {"docs": [], "children": set()}
        return len(node["docs"]) + sum(count(child) for child in node["children"])

    def build(path):
        node = folders.get(path) or {"docs": [], "children": set()}
        docs = sorted(node["docs"], key=lambda d: d["name"].lower())
        return {
            "path": path,
            "name": path.rsplit("/", 1)[-1],
            "total": count(path),
            "docs": docs[:per_folder],
            "more": max(0, len(docs) - per_folder),
            "folders": [build(child) for child in sorted(node["children"], key=str.lower)],
        }

    tops = sorted({path.split("/")[0] for path in folders}, key=str.lower)
    roots = sorted(root_docs, key=lambda d: d["name"].lower())
    return {
        "folders": [build(path) for path in tops],
        "docs": roots[:per_folder],
        "more": max(0, len(roots) - per_folder),
        "per_folder": per_folder,
        "total": len(rows),
    }
