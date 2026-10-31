"""fs/list entry cap: a directory over the cap truncates and flags it.

Kept out of ``test_fs_api.py`` so that file stays under the 300-SLOC budget.
"""


def test_list_caps_entries_and_flags_truncated(client, home):
    big = home / "big"
    big.mkdir()
    for i in range(2001):
        (big / f"f{i:05d}").write_text("")
    body = client.get("/api/fs/list", query_string={"path": str(big)}).get_json()
    assert len(body["entries"]) == 2000
    assert body["total"] == 2000
    assert body["truncated"] is True
