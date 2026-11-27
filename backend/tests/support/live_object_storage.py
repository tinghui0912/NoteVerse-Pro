"""Bounded signed HTTP transport and isolated, exhaustively checked test cleanup."""

from contextlib import contextmanager
import httpx
from app.storage.s3_compatible import S3CompatibleObjectStorage


class SignedProviderClient:
    def __init__(self):
        self.client = httpx.Client(timeout=httpx.Timeout(45, connect=10))

    def request(self, method, url, *, data=None, headers=None, expected=200, stage):
        try:
            response = self.client.request(method, url, content=data, headers=headers)
        except httpx.TransportError as error:
            # A timed-out mutation remains a failed/unknown experiment, even after zero inventory.
            raise AssertionError(f"{stage}: {type(error).__name__}; outcome UNKNOWN") from None
        assert response.status_code == expected, (
            f"{stage}: HTTP {response.status_code}, expected {expected}"
        )
        return response

    def close(self):
        self.client.close()


@contextmanager
def isolated_provider_namespace(storage: S3CompatibleObjectStorage, prefix: str):
    """Every cleanup failure is retained; no failed item suppresses another deletion."""
    assert prefix.endswith("/") and len(prefix.split("/")[-2]) == 32
    try:
        yield
    except Exception as error:
        facts = []
        cause = error
        seen = set()
        while cause is not None and id(cause) not in seen:
            seen.add(id(cause))
            response = getattr(cause, "response", {})
            status = (
                response.get("ResponseMetadata", {}).get("HTTPStatusCode")
                if isinstance(response, dict)
                else None
            )
            facts.append(
                type(cause).__name__ + (f":HTTP{status}" if isinstance(status, int) else "")
            )
            cause = cause.__context__
        error.add_note("Safe provider cause chain: " + " -> ".join(facts))
        raise
    finally:
        failures = []

        def attempt(stage, action):
            try:
                action()
            except Exception as error:
                failures.append(f"{stage}:{type(error).__name__}")

        def abort_uploads():
            for page in storage.client.get_paginator("list_multipart_uploads").paginate(
                Bucket=storage.bucket, Prefix=prefix
            ):
                for item in page.get("Uploads", []):
                    assert item["Key"].startswith(prefix)
                    attempt(
                        "abort",
                        lambda item=item: storage.abort_multipart_upload(
                            item["Key"], item["UploadId"]
                        ),
                    )

        def delete_objects():
            for page in storage.client.get_paginator("list_objects_v2").paginate(
                Bucket=storage.bucket, Prefix=prefix
            ):
                for item in page.get("Contents", []):
                    assert item["Key"].startswith(prefix)
                    attempt("delete", lambda item=item: storage.delete(item["Key"]))

        def delete_versions():
            for page in storage.client.get_paginator("list_object_versions").paginate(
                Bucket=storage.bucket, Prefix=prefix
            ):
                for item in [*page.get("Versions", []), *page.get("DeleteMarkers", [])]:
                    assert item["Key"].startswith(prefix)
                    attempt(
                        "delete_version",
                        lambda item=item: storage.client.delete_object(
                            Bucket=storage.bucket, Key=item["Key"], VersionId=item["VersionId"]
                        ),
                    )

        attempt("discover_uploads", abort_uploads)
        attempt("discover_objects", delete_objects)
        attempt("discover_versions", delete_versions)
        for operation, fields in [
            ("list_multipart_uploads", ("Uploads",)),
            ("list_objects_v2", ("Contents",)),
            ("list_object_versions", ("Versions", "DeleteMarkers")),
        ]:

            def verify(operation=operation, fields=fields):
                for page in storage.client.get_paginator(operation).paginate(
                    Bucket=storage.bucket, Prefix=prefix
                ):
                    assert not any(page.get(field) for field in fields)

            attempt("verify_" + operation, verify)
        assert not failures, "Provider cleanup BLOCKED: " + ", ".join(failures)
