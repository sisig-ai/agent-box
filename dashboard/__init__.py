"""Dashboard application package.

Split out of the former monolithic app.py (M2). ``create_app()`` is built up in
``dashboard/__init__.py``; Flask is imported lazily inside it so that the
telemetry collector can import package submodules without loading Flask.
"""
