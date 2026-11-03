"""Flask-flavoured test client over the ASGI app.

The suite was written against Flask's test client (``query_string=``, ``data=``
with a multipart content type, ``get_json()``). Keeping the shim here means
``create_app().test_client()`` still works while the routes move to FastAPI.
"""

from fastapi.testclient import TestClient


class Response:
    def __init__(self, response):
        self._response = response
        self.status_code = response.status_code
        self.headers = response.headers
        self.data = response.content
        self.text = response.text

    def get_json(self, silent=False):
        try:
            return self._response.json()
        except ValueError:
            if silent:
                return None
            raise

    def json(self):
        return self._response.json()


class Client:
    def __init__(self, app):
        self._client = TestClient(app)
        self.application = app

    def _request(self, method, path, **kwargs):
        # httpx collapses ".." before sending; Flask's client did not. Encode the
        # dots so traversal tests still reach the route and get the 400.
        path = path.replace("..", "%2E%2E").replace("/./", "/%2E/")
        query = kwargs.pop("query_string", None)
        data = kwargs.pop("data", None)
        content_type = kwargs.pop("content_type", None)
        if query is not None:
            kwargs["params"] = query
        if data is not None:
            if isinstance(data, (bytes, str)):
                kwargs["content"] = data
            elif content_type == "multipart/form-data":
                fields, files = {}, {}
                for key, value in data.items():
                    if isinstance(value, tuple):
                        stream, filename = value
                        payload = stream.read() if hasattr(stream, "read") else stream
                        files[key] = (filename, payload)
                    else:
                        fields[key] = str(value)
                kwargs["data"] = fields or None
                kwargs["files"] = files
                content_type = None  # let httpx add the boundary
            else:
                kwargs["data"] = data
        if content_type:
            headers = dict(kwargs.pop("headers", {}) or {})
            headers.setdefault("Content-Type", content_type)
            kwargs["headers"] = headers
        return Response(self._client.request(method, path, **kwargs))

    def get(self, path, **kwargs):
        return self._request("GET", path, **kwargs)

    def post(self, path, **kwargs):
        return self._request("POST", path, **kwargs)

    def put(self, path, **kwargs):
        return self._request("PUT", path, **kwargs)

    def patch(self, path, **kwargs):
        return self._request("PATCH", path, **kwargs)

    def delete(self, path, **kwargs):
        return self._request("DELETE", path, **kwargs)
