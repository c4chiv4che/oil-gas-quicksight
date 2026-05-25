"""Generate a QuickSight dashboard embed URL for the shared public-site reader.

The GitHub Pages site (https://c4chiv4che.github.io/oil-gas-quicksight/) is fully
static with no backend, so it calls this Lambda (via API Gateway HTTP API) to mint
a short-lived QuickSight embed URL on demand.

One shared reader identity -- deliberate cost choice:
    The public site embeds as a SINGLE fixed QuickSight *registered reader* user
    rather than per-visitor anonymous sessions. Anonymous embedding requires
    QuickSight "session capacity pricing" (~USD 250/mo minimum commitment), which
    is not justified for a learning/demo project. A single registered reader keeps
    the recurring cost to one QuickSight Enterprise reader (~USD 24/mo) and is only
    billed when the URL is actually used.

Graceful degradation:
    Embedding requires QuickSight ENTERPRISE. This account is on STANDARD by design.
    Until upgraded, GenerateEmbedUrlForRegisteredUser raises
    UnsupportedUserEditionException; we catch it and return a clean HTTP 503
    {"status": "embedding_unavailable", ...} so the endpoint is demonstrable today
    instead of throwing an opaque 500.
"""

from __future__ import annotations

import json
import os
from typing import Any

import boto3
from botocore.exceptions import ClientError

# Reused across warm invocations; region comes from the Lambda env (AWS_REGION).
_QUICKSIGHT = boto3.client("quicksight")

_ACCOUNT_ID = os.environ["QS_ACCOUNT_ID"]
_DASHBOARD_ID = os.environ["QS_DASHBOARD_ID"]
_READER_USER_ARN = os.environ["QS_READER_USER_ARN"]
_NAMESPACE = os.environ.get("QS_NAMESPACE", "default")  # informational; encoded in the reader ARN
_ALLOWED_ORIGIN = os.environ.get("ALLOWED_ORIGIN", "https://c4chiv4che.github.io")
_SESSION_MINUTES = int(os.environ.get("SESSION_LIFETIME_MINUTES", "60"))

# QuickSight edition/plan errors that mean "embedding simply isn't enabled here".
_EDITION_ERRORS = {"UnsupportedUserEditionException", "UnsupportedPricingPlanException"}


def _response(status_code: int, body: dict[str, Any]) -> dict[str, Any]:
    """API Gateway HTTP API (payload format 2.0) proxy response."""
    return {
        "statusCode": status_code,
        "headers": {
            "Content-Type": "application/json",
            # Mirrors the API Gateway CORS config so direct error responses carry it too.
            "Access-Control-Allow-Origin": _ALLOWED_ORIGIN,
        },
        "body": json.dumps(body),
    }


def handler(event: dict[str, Any], context: Any) -> dict[str, Any]:
    try:
        result = _QUICKSIGHT.generate_embed_url_for_registered_user(
            AwsAccountId=_ACCOUNT_ID,
            UserArn=_READER_USER_ARN,
            ExperienceConfiguration={"Dashboard": {"InitialDashboardId": _DASHBOARD_ID}},
            AllowedDomains=[_ALLOWED_ORIGIN],
            SessionLifetimeInMinutes=_SESSION_MINUTES,
        )
    except ClientError as exc:
        code = exc.response.get("Error", {}).get("Code", "")
        if code in _EDITION_ERRORS:
            # By-design path while on STANDARD: clean, documented unavailability.
            return _response(503, {
                "status": "embedding_unavailable",
                "reason": "QuickSight Enterprise required",
            })
        # Anything else is a genuine, unexpected failure.
        print(f"QuickSight embed error [{code}]: {exc}")
        return _response(500, {"status": "error", "reason": "could not generate embed url"})

    return _response(200, {"embedUrl": result["EmbedUrl"]})
