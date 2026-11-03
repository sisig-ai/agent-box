"""Dashboard application package.

``create_app()`` builds the FastAPI app (dashboard.asgi). Every route is a
FastAPI router; there is no second web framework.
"""


def create_app():
    from .asgi import create_app as build

    return build()
