# ─── RUNTIME IAM POLICY (oil-gas-dev user) ───────────────────────────────────
#
# Least-privilege managed policy for the RUNTIME identity `oil-gas-dev`.
# Consolidates 7 sprawling inline policies into a single managed policy.
#
# Scope: simulator/producer workloads + read-only `terraform plan` refresh.
#   - S3 read/write on the three project buckets (raw, curated, athena-results)
#   - Glue catalog READ
#   - Athena query execution (not workgroup management)
#   - Kinesis producer perms scoped to the wells stream ARN
#   - QuickSight read/describe/list (Standard edition; dashboard authoring
#     happens through the console — no Create*/Update*/Delete* here)
#   - IAM self-introspection + policy read (so `terraform plan` refresh works)
#
# Out of scope (deploy-only, lives in oil-gas-deploy-policy):
#   - bucket / stream / firehose / workgroup / database create/delete
#   - iam:CreateRole, iam:PassRole, iam:TagPolicy, iam:TagRole
#   - quicksight Create/Update/Delete
#   - cloudwatch:* / sns:* (one-time billing-alarm bootstrap)

resource "aws_iam_policy" "runtime" {
  name        = "oil-gas-dev-runtime"
  description = "Runtime + plan-refresh permissions for oil-gas-dev. Replaces 7 inline policies. Deploy ops live in oil-gas-deploy-policy."

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3BucketLevel"
        Effect = "Allow"
        Action = [
          "s3:ListBucket",
          "s3:GetBucketLocation"
        ]
        Resource = [
          aws_s3_bucket.raw.arn,
          aws_s3_bucket.curated.arn,
          aws_s3_bucket.athena_results.arn
        ]
      },
      {
        Sid    = "S3ObjectRW"
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:AbortMultipartUpload"
        ]
        Resource = [
          "${aws_s3_bucket.raw.arn}/*",
          "${aws_s3_bucket.curated.arn}/*",
          "${aws_s3_bucket.athena_results.arn}/*"
        ]
      },
      {
        Sid    = "GlueCatalogRead"
        Effect = "Allow"
        Action = [
          "glue:GetDatabase",
          "glue:GetDatabases",
          "glue:GetTable",
          "glue:GetTables",
          "glue:GetTableVersion",
          "glue:GetTableVersions",
          "glue:GetPartition",
          "glue:GetPartitions",
          "glue:BatchGetPartition",
          "glue:GetCrawler",
          "glue:GetCrawlers"
        ]
        Resource = "*"
      },
      {
        # CTAS data-transformation writes (e.g. `make curated`). Scoped to the
        # oil_gas_db catalog/database/tables. Database + crawler lifecycle stay
        # deploy-only — no CreateDatabase / DeleteDatabase / CreateCrawler /
        # StartCrawler here.
        Sid    = "GlueDataTableWrite"
        Effect = "Allow"
        Action = [
          "glue:CreateTable",
          "glue:DeleteTable",
          "glue:UpdateTable",
          "glue:BatchCreatePartition",
          "glue:BatchDeletePartition"
        ]
        Resource = [
          "arn:aws:glue:${var.region}:${var.account_id}:catalog",
          "arn:aws:glue:${var.region}:${var.account_id}:database/${aws_glue_catalog_database.oil_gas.name}",
          "arn:aws:glue:${var.region}:${var.account_id}:table/${aws_glue_catalog_database.oil_gas.name}/*"
        ]
      },
      {
        Sid    = "AthenaQuery"
        Effect = "Allow"
        Action = [
          "athena:StartQueryExecution",
          "athena:GetQueryExecution",
          "athena:GetQueryResults",
          "athena:StopQueryExecution",
          "athena:GetWorkGroup",
          "athena:ListWorkGroups"
        ]
        Resource = "*"
      },
      {
        Sid    = "KinesisProducerWells"
        Effect = "Allow"
        Action = [
          "kinesis:PutRecord",
          "kinesis:PutRecords",
          "kinesis:DescribeStream",
          "kinesis:DescribeStreamSummary",
          "kinesis:ListShards",
          "kinesis:ListTagsForStream"
        ]
        Resource = aws_kinesis_stream.wells.arn
      },
      {
        Sid    = "FirehoseReadForPlan"
        Effect = "Allow"
        Action = [
          "firehose:DescribeDeliveryStream",
          "firehose:ListTagsForDeliveryStream"
        ]
        Resource = "arn:aws:firehose:${var.region}:${var.account_id}:deliverystream/vaca-muerta-*"
      },
      {
        Sid    = "QuickSightReadOnly"
        Effect = "Allow"
        Action = [
          "quicksight:Describe*",
          "quicksight:List*"
        ]
        Resource = "*"
      },
      {
        Sid    = "IAMSelfIntrospection"
        Effect = "Allow"
        Action = [
          "iam:GetUser",
          "iam:GetUserPolicy",
          "iam:ListUserPolicies",
          "iam:ListAttachedUserPolicies"
        ]
        Resource = "arn:aws:iam::${var.account_id}:user/oil-gas-dev"
      },
      {
        Sid    = "IAMPolicyReadForPlan"
        Effect = "Allow"
        Action = [
          "iam:GetPolicy",
          "iam:GetPolicyVersion",
          "iam:ListPolicyVersions",
          "iam:ListEntitiesForPolicy"
        ]
        Resource = "arn:aws:iam::${var.account_id}:policy/oil-gas-*"
      },
      {
        Sid    = "IAMRoleReadForPlan"
        Effect = "Allow"
        Action = [
          "iam:GetRole",
          "iam:ListRolePolicies",
          "iam:GetRolePolicy",
          "iam:ListAttachedRolePolicies",
          "iam:ListInstanceProfilesForRole"
        ]
        Resource = "arn:aws:iam::${var.account_id}:role/oil-gas-*"
      }
    ]
  })
}

resource "aws_iam_user_policy_attachment" "runtime" {
  user       = "oil-gas-dev"
  policy_arn = aws_iam_policy.runtime.arn
}
