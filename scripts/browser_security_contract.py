"""Validate gateway-owned transport security and explicit browser storage authorities."""

from urllib.parse import urlsplit

HSTS = "max-age=63072000; includeSubDomains"
BROWSER_ROUTES = {"noteverse-web", "noteverse-platform-admin"}


def storage_origins(value: str) -> tuple[str, ...]:
    if not value.strip():
        raise ValueError(
            "CSP_OBJECT_STORAGE_ORIGINS must explicitly name public storage/CDN origins"
        )
    result = []
    for entry in value.split(","):
        text = entry.strip()
        url = urlsplit(text)
        if (
            url.scheme not in {"https", "http"}
            or not url.hostname
            or url.username is not None
            or url.password is not None
            or url.path not in {"", "/"}
            or url.query
            or url.fragment
            or any(char.isspace() or char in "*?#;'\"%\\" for char in text)
        ):
            raise ValueError("Storage CSP entries must be normalized HTTP(S) origins")
        host = url.hostname.encode("idna").decode("ascii").lower()
        if ":" in host:
            host = "[" + host + "]"
        port = url.port
        authority = f"{url.scheme}://{host}" + (
            f":{port}" if port and port != (443 if url.scheme == "https" else 80) else ""
        )
        if text not in {authority, authority + "/"}:
            raise ValueError("Storage CSP entries must contain no path or noncanonical authority")
        if authority not in result:
            result.append(authority)
    return tuple(result)


def validate_browser_documents(documents: list[dict]) -> list[str]:
    errors = []
    for doc in documents:
        if doc.get("kind") == "HTTPRoute" and doc.get("metadata", {}).get("name") in BROWSER_ROUTES:
            name = doc["metadata"]["name"]
            if not doc.get("spec", {}).get("rules"):
                errors.append(f"{name}: HTTPS routing rules are required")
            for index, rule in enumerate(doc.get("spec", {}).get("rules", [])):
                hsts = []
                for item in rule.get("filters", []):
                    modifier = item.get("responseHeaderModifier", {})
                    for operation in ("add", "set"):
                        for header in modifier.get(operation, []):
                            field = header["name"].lower()
                            if field == "strict-transport-security":
                                hsts.append((operation, header.get("value")))
                            if field == "content-security-policy":
                                errors.append(f"{name}: gateway cannot emit document CSP")
                    if any(
                        header.lower() in {"content-security-policy", "strict-transport-security"}
                        for header in modifier.get("remove", [])
                    ):
                        errors.append(f"{name}: gateway cannot strip browser security authority")
                if hsts != [("set", HSTS)]:
                    errors.append(f"{name} rule {index}: exact HSTS must be set once")
        if (
            doc.get("kind") == "ConfigMap"
            and doc.get("metadata", {}).get("name") == "noteverse-customer-web-config"
        ):
            try:
                values = storage_origins(doc.get("data", {}).get("CSP_OBJECT_STORAGE_ORIGINS", ""))
                if any(not origin.startswith("https://") for origin in values):
                    errors.append("Customer Web deployment requires HTTPS storage/CDN origins")
            except ValueError as error:
                errors.append(str(error))
        annotations = doc.get("metadata", {}).get("annotations", {})
        if any("content-security-policy" in str(value).lower() for value in annotations.values()):
            errors.append("Gateway annotations cannot emit or overwrite document CSP")
    limits = {"noteverse-web": "32Mi", "noteverse-platform-admin": "512Ki"}
    for route in (doc for doc in documents if doc.get("kind") == "HTTPRoute"):
        name = route.get("metadata", {}).get("name")
        if name not in limits:
            continue
        policies = [
            doc
            for doc in documents
            if doc.get("kind") == "BackendTrafficPolicy"
            and any(
                ref.get("kind") == "HTTPRoute" and ref.get("name") == name
                for ref in doc.get("spec", {}).get("targetRefs", [])
            )
        ]
        expected_target = {"group": "gateway.networking.k8s.io", "kind": "HTTPRoute", "name": name}
        valid = len(policies) == 1
        if valid:
            policy = policies[0]
            references = [
                ref
                for ref in policy["spec"]["targetRefs"]
                if ref.get("kind") == "HTTPRoute" and ref.get("name") == name
            ]
            valid = (
                all(ref == expected_target for ref in references)
                and policy.get("metadata", {}).get("namespace")
                == route.get("metadata", {}).get("namespace")
                and policy["spec"].get("requestBuffer") == {"limit": limits[name]}
            )
        if not valid:
            errors.append(
                f"{name}: gateway request body limit must be {limits[name]} on the entire route"
            )
    return errors
