"""Formula engine for Tables: a small, safe expression language.

No eval/exec. Grammar (lowest to highest): || , && , ! , comparisons, + - ,
* / %, unary minus, primary. Primaries are numbers, quoted strings, TRUE/FALSE/
NULL, ``{Column Name}`` references, function calls, and parentheses.

Functions: IF, AND, OR, NOT, CONCAT, LEN, UPPER, LOWER, TRIM, ROUND, ABS, MIN,
MAX, SUM, AVG, COUNT, ISEMPTY, TODAY, NOW, YEAR, MONTH, DAY, LOOKUP.
"""

import re
from datetime import UTC, datetime

from .table_types import TableError

_TOKEN = re.compile(
    r"""
    \s+
  | (?P<number>\d+(?:\.\d+)?)
  | (?P<string>"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')
  | (?P<ref>\{[^{}]+\})
  | (?P<op><=|>=|<>|!=|==|&&|\|\||[+\-*/%<>=!(),])
  | (?P<ident>[A-Za-z_][A-Za-z0-9_]*)
""",
    re.VERBOSE,
)


def tokenize(text):
    tokens, pos = [], 0
    while pos < len(text):
        match = _TOKEN.match(text, pos)
        if not match:
            raise TableError(f"formula: unexpected character at {pos}: {text[pos]!r}")
        pos = match.end()
        kind = match.lastgroup
        if kind is None:
            continue
        raw = match.group()
        if kind == "string":
            tokens.append(("str", raw[1:-1].replace('\\"', '"').replace("\\'", "'")))
        elif kind == "number":
            tokens.append(("num", float(raw) if "." in raw else int(raw)))
        elif kind == "ref":
            tokens.append(("ref", raw[1:-1].strip()))
        else:
            tokens.append((kind, raw))
    tokens.append(("end", None))
    return tokens


class _Parser:
    def __init__(self, tokens, text):
        self.tokens = tokens
        self.text = text
        self.pos = 0

    def peek(self):
        return self.tokens[self.pos]

    def take(self):
        token = self.tokens[self.pos]
        self.pos += 1
        return token

    def expect(self, value):
        kind, raw = self.take()
        if raw != value:
            raise TableError(f"formula: expected {value!r} in {self.text!r}")

    def parse(self):
        node = self.or_expr()
        if self.peek()[0] != "end":
            raise TableError(f"formula: unexpected {self.peek()[1]!r} in {self.text!r}")
        return node

    def or_expr(self):
        node = self.and_expr()
        while self._op("||", "or"):
            node = ("or", node, self.and_expr())
        return node

    def and_expr(self):
        node = self.not_expr()
        while self._op("&&", "and"):
            node = ("and", node, self.not_expr())
        return node

    def _op(self, *values):
        kind, raw = self.peek()
        if kind == "op" and raw.lower() in values:
            self.take()
            return True
        if kind == "ident" and str(raw).lower() in values:
            self.take()
            return True
        return False

    def not_expr(self):
        kind, raw = self.peek()
        if (kind == "op" and raw == "!") or (kind == "ident" and raw.lower() == "not"):
            self.take()
            return ("not", self.not_expr())
        return self.compare()

    def compare(self):
        node = self.sum_expr()
        kind, raw = self.peek()
        if kind == "op" and raw in ("=", "==", "!=", "<>", "<", "<=", ">", ">="):
            self.take()
            node = ("cmp", raw, node, self.sum_expr())
        return node

    def sum_expr(self):
        node = self.term()
        while True:
            kind, raw = self.peek()
            if kind == "op" and raw in ("+", "-"):
                self.take()
                node = ("math", raw, node, self.term())
            else:
                return node

    def term(self):
        node = self.unary()
        while True:
            kind, raw = self.peek()
            if kind == "op" and raw in ("*", "/", "%"):
                self.take()
                node = ("math", raw, node, self.unary())
            else:
                return node

    def unary(self):
        kind, raw = self.peek()
        if kind == "op" and raw == "-":
            self.take()
            return ("neg", self.unary())
        if kind == "op" and raw == "+":
            self.take()
            return self.unary()
        return self.primary()

    def primary(self):
        kind, raw = self.take()
        if kind in ("num", "str"):
            return ("lit", raw)
        if kind == "ref":
            return ("ref", raw)
        if kind == "op" and raw == "(":
            node = self.or_expr()
            self.expect(")")
            return node
        if kind == "ident":
            lowered = raw.lower()
            if lowered == "true":
                return ("lit", True)
            if lowered == "false":
                return ("lit", False)
            if lowered in ("null", "none"):
                return ("lit", None)
            if self.peek()[1] == "(":
                self.take()
                args = []
                if self.peek()[1] != ")":
                    args.append(self.or_expr())
                    while self.peek()[1] == ",":
                        self.take()
                        args.append(self.or_expr())
                self.expect(")")
                return ("call", lowered, args)
            raise TableError(f"formula: unknown name {raw!r} (use {{Column}} for a cell)")
        raise TableError(f"formula: unexpected {raw!r} in {self.text!r}")


def parse(expression):
    return _Parser(tokenize(expression), expression).parse()


def _number(value, what="value"):
    if isinstance(value, bool) or value is None:
        return None
    if isinstance(value, (int, float)):
        return value
    try:
        return float(str(value))
    except (TypeError, ValueError):
        raise TableError(f"formula: {what} is not a number") from None


def _truthy(value):
    if isinstance(value, list):
        return bool(value)
    if isinstance(value, str):
        return value.strip() != ""
    return bool(value)


def _as_datetime(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    return parsed if parsed.tzinfo else parsed.replace(tzinfo=UTC)


def _flatten(values):
    out = []
    for value in values:
        if isinstance(value, list):
            out.extend(value)
        elif value is not None:
            out.append(value)
    return out


def _compare(op, left, right):
    if isinstance(left, str) and isinstance(right, str):
        dl, dr = _as_datetime(left), _as_datetime(right)
        if dl and dr:
            left, right = dl, dr
    if op in ("=", "=="):
        return left == right
    if op in ("!=", "<>"):
        return left != right
    if left is None or right is None:
        return False
    try:
        if op == "<":
            return left < right
        if op == "<=":
            return left <= right
        if op == ">":
            return left > right
        return left >= right
    except TypeError:
        return False


def _call(name, args, resolve, lookup):
    if name == "if":
        return args[1] if _truthy(args[0]) else args[2] if len(args) > 2 else None
    if name == "and":
        return all(_truthy(a) for a in args)
    if name == "or":
        return any(_truthy(a) for a in args)
    if name == "not":
        return not _truthy(args[0])
    if name == "concat":
        return "".join("" if a is None else str(a) for a in args)
    if name == "len":
        return len(args[0] or "") if not isinstance(args[0], list) else len(args[0])
    if name == "upper":
        return str(args[0] or "").upper()
    if name == "lower":
        return str(args[0] or "").lower()
    if name == "trim":
        return str(args[0] or "").strip()
    if name == "round":
        digits = int(_number(args[1], "digits") or 0) if len(args) > 1 else 0
        value = _number(args[0])
        return None if value is None else round(value, digits)
    if name == "abs":
        value = _number(args[0])
        return None if value is None else abs(value)
    if name in ("min", "max", "sum", "avg"):
        numbers = [_number(v) for v in _flatten(args)]
        numbers = [n for n in numbers if n is not None]
        if not numbers:
            return 0 if name == "sum" else None
        if name == "min":
            return min(numbers)
        if name == "max":
            return max(numbers)
        if name == "sum":
            return sum(numbers)
        return sum(numbers) / len(numbers)
    if name == "count":
        return len(_flatten(args))
    if name == "isempty":
        value = args[0]
        if isinstance(value, list):
            return not value
        return value is None or (isinstance(value, str) and not value.strip())
    if name in ("today", "now"):
        now = datetime.now().astimezone()
        return now.date().isoformat() if name == "today" else now.isoformat(timespec="seconds")
    if name in ("year", "month", "day"):
        moment = _as_datetime(args[0] if isinstance(args[0], str) else None)
        if moment is None:
            return None
        return getattr(moment, {"year": "year", "month": "month", "day": "day"}[name])
    if name == "lookup":
        if lookup is None:
            return None
        return lookup(args[0], str(args[1] or ""))
    if name == "ref":
        return args[0]
    raise TableError(f"formula: unknown function {name}()")


def evaluate(node, resolve, lookup=None):
    """Evaluate a parsed formula. ``resolve(column_name)`` returns a cell value."""
    kind = node[0]
    if kind == "lit":
        return node[1]
    if kind == "ref":
        return resolve(node[1])
    if kind == "neg":
        value = _number(evaluate(node[1], resolve, lookup))
        return None if value is None else -value
    if kind == "not":
        return not _truthy(evaluate(node[1], resolve, lookup))
    if kind in ("and", "or"):
        left = _truthy(evaluate(node[1], resolve, lookup))
        return (
            (left and _truthy(evaluate(node[2], resolve, lookup)))
            if kind == "and"
            else (left or _truthy(evaluate(node[2], resolve, lookup)))
        )
    if kind == "cmp":
        return _compare(
            node[1], evaluate(node[2], resolve, lookup), evaluate(node[3], resolve, lookup)
        )
    if kind == "math":
        op, left, right = (
            node[1],
            evaluate(node[2], resolve, lookup),
            evaluate(node[3], resolve, lookup),
        )
        if op == "+" and (isinstance(left, str) or isinstance(right, str)):
            return f"{left if left is not None else ''}{right if right is not None else ''}"
        a, b = _number(left), _number(right)
        if a is None or b is None:
            return None
        if op == "+":
            return a + b
        if op == "-":
            return a - b
        if op == "*":
            return a * b
        if op == "/":
            return None if b == 0 else a / b
        return None if b == 0 else a % b
    if kind == "call":
        return _call(node[1], [evaluate(arg, resolve, lookup) for arg in node[2]], resolve, lookup)
    raise TableError(f"formula: cannot evaluate {node!r}")


def evaluate_expression(expression, resolve, lookup=None):
    """Parse + evaluate in one call; raises TableError with a readable message."""
    try:
        return evaluate(parse(expression), resolve, lookup)
    except TableError:
        raise
    except Exception as exc:  # noqa: BLE001 - the surface must never 500 on a bad formula
        raise TableError(f"formula failed: {exc}") from None
