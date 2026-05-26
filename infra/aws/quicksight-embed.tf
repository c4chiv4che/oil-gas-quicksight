# ─── QUICKSIGHT DASHBOARD EMBEDDING API ──────────────────────────────────────
#
# Server-side endpoint for the STATIC GitHub Pages site
# (https://c4chiv4che.github.io/oil-gas-quicksight/), which has no backend of its
# own. A Lambda behind an HTTP API mints short-lived QuickSight embed URLs for one
# shared "public reader" identity.
#
# COST NOTE:
#   - This stack is ~USD 0/mo: Lambda + HTTP API sit inside the perpetual free
#     tier at demo traffic; CloudWatch Logs are negligible.
#   - The real recurring cost is QuickSight ENTERPRISE (one reader ~USD 24/mo),
#     which is NOT activated. Until it is, the endpoint returns
#     {"status":"embedding_unavailable"} (HTTP 503) by design.
#   - Single registered reader is a deliberate choice over ANONYMOUS embedding,
#     which needs session-capacity pricing (~USD 250/mo minimum).
#
# DEPLOY IDENTITY: apply with the admin profile -- TF_VAR_aws_profile=default.
# The oil-gas-* role name keeps this within the documented deploy-policy scope.
#
# NOTE: the hashicorp/archive provider (used by the Lambda packaging below) is
# declared in providers.tf -- Terraform permits only one required_providers block
# per module.

# ─── VARIABLES ───────────────────────────────────────────────────────────────

variable "embed_dashboard_id" {
  description = "QuickSight dashboard ID to embed. Built in the console (CreateDashboard is Enterprise-only on this account). Placeholder until a dashboard exists."
  default     = "REPLACE_WITH_DASHBOARD_ID"
}

variable "embed_reader_user_arn" {
  description = "ARN of the shared QuickSight READER the site embeds as. READER is Enterprise-only, so this user does NOT exist on STANDARD yet -- populate after the Enterprise upgrade. Empty falls back to a constructed placeholder so the config still validates/applies."
  default     = ""
}

variable "embed_namespace" {
  description = "QuickSight namespace for the reader user."
  default     = "default"
}

variable "embed_reader_user_name" {
  description = "Username of the shared public reader (used only to build the placeholder ARN when embed_reader_user_arn is empty)."
  default     = "oil-gas-public-reader"
}

variable "embed_allowed_origin" {
  description = "Single origin allowed to call the API and host the embed (origin only, no path)."
  default     = "https://c4chiv4che.github.io"
}

variable "embed_session_lifetime_minutes" {
  description = "QuickSight embed session lifetime (15-600)."
  default     = 60
}

# ─── LOCALS ──────────────────────────────────────────────────────────────────

locals {
  embed_dashboard_arn = "arn:aws:quicksight:${var.region}:${var.account_id}:dashboard/${var.embed_dashboard_id}"

  # Effective reader ARN: provided value, else a constructed placeholder so IAM
  # scoping is a valid ARN even before the Enterprise reader is created.
  embed_reader_user_arn = (
    var.embed_reader_user_arn != ""
    ? var.embed_reader_user_arn
    : "arn:aws:quicksight:${var.region}:${var.account_id}:user/${var.embed_namespace}/${var.embed_reader_user_name}"
  )
}

# ─── LAMBDA PACKAGE ──────────────────────────────────────────────────────────

data "archive_file" "embed_url" {
  type        = "zip"
  source_file = "${path.module}/lambda/embed_url.py"
  output_path = "${path.module}/lambda/embed_url.zip"
}

# ─── LAMBDA EXECUTION ROLE (least privilege) ─────────────────────────────────

resource "aws_iam_role" "embed_lambda" {
  name = "oil-gas-embed-lambda-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect    = "Allow"
      Action    = "sts:AssumeRole"
      Principal = { Service = "lambda.amazonaws.com" }
    }]
  })
}

resource "aws_cloudwatch_log_group" "embed_lambda" {
  name              = "/aws/lambda/${aws_lambda_function.embed_url.function_name}"
  retention_in_days = 14
}

resource "aws_iam_role_policy" "embed_lambda" {
  name = "embed-lambda-policy"
  role = aws_iam_role.embed_lambda.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/lambda/oil-gas-embed-url:*"
      },
      {
        # Scoped to the user resource type (the only type this action supports).
        # Dashboard access is granted by SHARING the dashboard with this reader in
        # QuickSight, not via IAM.
        #
        # Domain lock: quicksight:AllowedEmbeddingDomains is a MULTIVALUED key (the
        # AllowedDomains param is an array), so a set operator is required.
        #   - ForAllValues:StringEquals -> every requested domain must be exactly
        #     our origin (no extra domains, exact string -- rejects trailing-slash
        #     and case variants).
        #   - Null:false -> the key MUST be present. ForAllValues alone returns TRUE
        #     when the key is absent/empty, which would let a caller omit
        #     AllowedDomains and bypass the lock. AWS explicitly recommends pairing
        #     ForAllValues in an Allow with a Null:false guard. This is stricter
        #     than AWS's own published QuickSight sample (which omits the guard).
        Sid      = "QuickSightGenerateEmbedUrl"
        Effect   = "Allow"
        Action   = "quicksight:GenerateEmbedUrlForRegisteredUser"
        Resource = local.embed_reader_user_arn
        Condition = {
          "ForAllValues:StringEquals" = {
            "quicksight:AllowedEmbeddingDomains" = [var.embed_allowed_origin]
          }
          "Null" = {
            "quicksight:AllowedEmbeddingDomains" = "false"
          }
        }
      }
    ]
  })
}

# ─── LAMBDA FUNCTION ─────────────────────────────────────────────────────────

resource "aws_lambda_function" "embed_url" {
  function_name    = "oil-gas-embed-url"
  role             = aws_iam_role.embed_lambda.arn
  runtime          = "python3.12"
  handler          = "embed_url.handler"
  filename         = data.archive_file.embed_url.output_path
  source_code_hash = data.archive_file.embed_url.output_base64sha256
  timeout          = 10
  memory_size      = 128

  environment {
    variables = {
      QS_ACCOUNT_ID            = var.account_id
      QS_DASHBOARD_ID          = var.embed_dashboard_id
      QS_READER_USER_ARN       = local.embed_reader_user_arn
      QS_NAMESPACE             = var.embed_namespace
      ALLOWED_ORIGIN           = var.embed_allowed_origin
      SESSION_LIFETIME_MINUTES = tostring(var.embed_session_lifetime_minutes)
    }
  }
}

# ─── API GATEWAY HTTP API (v2) ───────────────────────────────────────────────

resource "aws_apigatewayv2_api" "embed" {
  name          = "oil-gas-embed-api"
  protocol_type = "HTTP"
  description   = "Mints QuickSight embed URLs for the static GitHub Pages site."

  cors_configuration {
    allow_origins = [var.embed_allowed_origin]
    allow_methods = ["GET", "OPTIONS"]
    allow_headers = ["content-type"]
    max_age       = 3600
  }
}

resource "aws_apigatewayv2_integration" "embed" {
  api_id                 = aws_apigatewayv2_api.embed.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.embed_url.invoke_arn
  integration_method     = "POST" # Lambda proxy is always POST under the hood
  payload_format_version = "2.0"
}

resource "aws_apigatewayv2_route" "embed" {
  api_id    = aws_apigatewayv2_api.embed.id
  route_key = "GET /embed-url"
  target    = "integrations/${aws_apigatewayv2_integration.embed.id}"
}

resource "aws_apigatewayv2_stage" "embed" {
  api_id      = aws_apigatewayv2_api.embed.id
  name        = "$default"
  auto_deploy = true
}

resource "aws_lambda_permission" "apigw" {
  statement_id  = "AllowInvokeFromHttpApi"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.embed_url.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.embed.execution_arn}/*/*"
}

# ─── SHARED READER USER (create AFTER upgrading to Enterprise) ────────────────
#
# READER is an Enterprise-only role; RegisterUser with user_role="READER" fails on
# STANDARD. So we do NOT create it here. After the Enterprise upgrade, register the
# reader (console or CLI), then set TF_VAR_embed_reader_user_arn and re-apply, and
# share the embedded dashboard with this reader in QuickSight. Reference:
#
#   aws quicksight register-user \
#     --aws-account-id 919064997947 --namespace default \
#     --identity-type QUICKSIGHT --user-role READER \
#     --user-name oil-gas-public-reader --email your.email@example.com \
#     --region us-east-1
