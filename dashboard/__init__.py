"""Dashboard application package.

``create_app()`` builds the FastAPI app (dashboard.asgi). The Flask factory and
the blueprints it still owns live in dashboard.legacy, which the ASGI app mounts
for the routes that have not been converted yet.
"""


def create_app():
    from .asgi import create_app as build

    return build()
