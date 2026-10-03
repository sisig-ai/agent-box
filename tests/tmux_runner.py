"""Shared subprocess.run fake for the tmux backend tests."""


class FakeCompleted:
    def __init__(self, returncode=0, stdout=b"", stderr=b""):
        self.returncode = returncode
        self.stdout = stdout
        self.stderr = stderr


class Runner:
    """Records argv/kwargs; returns queued responses or raises queued exceptions."""

    def __init__(self):
        self.calls = []
        self.kwargs = []
        self.responses = []

    def __call__(self, args, **kwargs):
        self.calls.append(list(args))
        self.kwargs.append(kwargs)
        response = self.responses.pop(0) if self.responses else FakeCompleted()
        if isinstance(response, Exception):
            raise response
        return response


def mk(**kwargs):
    return FakeCompleted(**kwargs)
