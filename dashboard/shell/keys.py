"""Allowlisted keys for the host shell endpoints.

tmux send-keys takes a direct argv list, so each key is one argument. This
module owns the allowlist and the modifier composer; dashboard/shell/tmux.py
owns the process call. Split out to stay under the per-file line budget.
"""

_MODS = ("C", "M", "S")

# Named keys accepted on their own: client name -> tmux send-keys name.
SHELL_KEYS = {
    "Enter": "Enter",
    "Backspace": "BSpace",
    "Tab": "Tab",
    "Escape": "Escape",
    "Up": "Up",
    "Down": "Down",
    "Left": "Left",
    "Right": "Right",
    "Home": "Home",
    "End": "End",
    "PageUp": "PageUp",
    "PageDown": "PageDown",
    "Delete": "DC",
    "Insert": "IC",
}

# tmux 'S-Tab' emits a plain tab; the shift-tab byte is the back-tab name.
_SHIFTED_NAMES = {"Tab": "BTab"}


def _printable(rest):
    return len(rest) == 1 and 0x20 <= ord(rest) < 0x7F and rest != "-"


def resolve_key(spec):
    """Return the tmux argument for a client key spec, or None if not allowed.

    Accepts a bare named key ("Escape") and modifier-composed specs
    ("C-c", "M-Left", "C-M-x", "S-Up", "S-Tab" -> "BTab"). The base is a
    known key name or one printable ASCII character; the result never starts
    with '-' so it can never be read as a tmux flag.
    """
    rest = spec if isinstance(spec, str) else ""
    mods = []
    while len(rest) > 2 and rest[1] == "-" and rest[0] in _MODS:
        mods.append(rest[0])
        rest = rest[2:]
    if rest in SHELL_KEYS:
        if "S" in mods and rest in _SHIFTED_NAMES:
            mods.remove("S")
            rest = _SHIFTED_NAMES[rest]
        else:
            rest = SHELL_KEYS[rest]
    elif not _printable(rest):
        return None
    if not mods:
        return rest
    return "".join(f"{m}-" for m in mods) + rest
