# ─── DEPLOY/ADMIN IAM POLICY (DOCUMENTATION-AS-CODE) ─────────────────────────
#
# This managed policy documents the FULL permission set required to deploy
# every resource in this Terraform module from scratch (S3, Glue, Athena,
# Kinesis, Firehose, IAM role management for the oil-gas-* roles, CloudWatch
# Logs, QuickSight).
#
# It is intentionally NOT attached to any identity. The runtime user
# `oil-gas-dev` is purposely scoped narrower (S3 read/write + producer
# perms — see docs/ARCHITECTURE.md "Deployment & permissions model").
#
# To use this policy for a one-off bootstrap apply:
#   1. Create a separate deploy/admin IAM user (e.g. `oil-gas-admin`).
#   2. Attach this policy: `aws iam attach-user-policy --user-name
#      oil-gas-admin --policy-arn <arn from output below>`.
#   3. Configure an AWS CLI profile for it and run
#      `TF_VAR_aws_profile=oil-gas-admin terraform apply`.
#
# Resource = "*" is acceptable for a personal/dev account; tighten before
# any production-like use.

resource "aws_iam_policy" "deploy" {
  name        = "oil-gas-deploy-policy"
  description = "Full permission set required to deploy the oil-gas-quicksight Terraform module. Documentation-as-code — attach to a dedicated deploy/admin user, NOT to oil-gas-dev."

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "S3Buckets"
        Effect = "Allow"
        Action = [
          "s3:CreateBucket",
          "s3:DeleteBucket",
          "s3:GetBucketLocation",
          "s3:GetBucketTagging",
          "s3:GetBucketVersioning",
          "s3:GetBucketPolicy",
          "s3:GetBucketAcl",
          "s3:GetBucketCORS",
          "s3:GetBucketLogging",
          "s3:GetBucketObjectLockConfiguration",
          "s3:GetBucketPublicAccessBlock",
          "s3:GetBucketRequestPayment",
          "s3:GetBucketWebsite",
          "s3:GetLifecycleConfiguration",
          "s3:GetEncryptionConfiguration",
          "s3:GetReplicationConfiguration",
          "s3:GetAccelerateConfiguration",
          "s3:ListBucket",
          "s3:ListAllMyBuckets",
          "s3:PutBucketTagging",
          "s3:PutBucketVersioning",
          "s3:PutBucketPolicy",
          "s3:PutLifecycleConfiguration",
          "s3:PutEncryptionConfiguration",
          "s3:PutBucketPublicAccessBlock",
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:AbortMultipartUpload"
        ]
        Resource = "*"
      },
      {
        Sid    = "Glue"
        Effect = "Allow"
        Action = [
          "glue:CreateDatabase",
          "glue:DeleteDatabase",
          "glue:GetDatabase",
          "glue:GetDatabases",
          "glue:UpdateDatabase",
          "glue:CreateTable",
          "glue:DeleteTable",
          "glue:GetTable",
          "glue:GetTables",
          "glue:GetTableVersion",
          "glue:GetTableVersions",
          "glue:UpdateTable",
          "glue:GetPartitions",
          "glue:CreateCrawler",
          "glue:DeleteCrawler",
          "glue:GetCrawler",
          "glue:GetCrawlers",
          "glue:UpdateCrawler",
          "glue:StartCrawler",
          "glue:StopCrawler",
          "glue:TagResource",
          "glue:UntagResource",
          "glue:GetTags"
        ]
        Resource = "*"
      },
      {
        Sid    = "Athena"
        Effect = "Allow"
        Action = [
          "athena:CreateWorkGroup",
          "athena:DeleteWorkGroup",
          "athena:GetWorkGroup",
          "athena:ListWorkGroups",
          "athena:UpdateWorkGroup",
          "athena:TagResource",
          "athena:UntagResource",
          "athena:ListTagsForResource",
          "athena:StartQueryExecution",
          "athena:GetQueryExecution",
          "athena:GetQueryResults",
          "athena:StopQueryExecution"
        ]
        Resource = "*"
      },
      {
        Sid    = "Kinesis"
        Effect = "Allow"
        Action = [
          "kinesis:CreateStream",
          "kinesis:DeleteStream",
          "kinesis:DescribeStream",
          "kinesis:DescribeStreamSummary",
          "kinesis:ListStreams",
          "kinesis:ListShards",
          "kinesis:AddTagsToStream",
          "kinesis:RemoveTagsFromStream",
          "kinesis:ListTagsForStream",
          "kinesis:IncreaseStreamRetentionPeriod",
          "kinesis:DecreaseStreamRetentionPeriod",
          "kinesis:UpdateShardCount",
          "kinesis:StartStreamEncryption",
          "kinesis:StopStreamEncryption"
        ]
        Resource = "*"
      },
      {
        Sid    = "Firehose"
        Effect = "Allow"
        Action = [
          "firehose:CreateDeliveryStream",
          "firehose:DeleteDeliveryStream",
          "firehose:DescribeDeliveryStream",
          "firehose:ListDeliveryStreams",
          "firehose:UpdateDestination",
          "firehose:TagDeliveryStream",
          "firehose:UntagDeliveryStream",
          "firehose:ListTagsForDeliveryStream",
          "firehose:StartDeliveryStreamEncryption",
          "firehose:StopDeliveryStreamEncryption"
        ]
        Resource = "*"
      },
      {
        Sid    = "IAMRoleManagement"
        Effect = "Allow"
        Action = [
          "iam:CreateRole",
          "iam:DeleteRole",
          "iam:GetRole",
          "iam:UpdateRole",
          "iam:UpdateAssumeRolePolicy",
          "iam:TagRole",
          "iam:UntagRole",
          "iam:ListRoleTags",
          "iam:PutRolePolicy",
          "iam:DeleteRolePolicy",
          "iam:GetRolePolicy",
          "iam:ListRolePolicies",
          "iam:AttachRolePolicy",
          "iam:DetachRolePolicy",
          "iam:ListAttachedRolePolicies",
          "iam:ListInstanceProfilesForRole"
        ]
        Resource = [
          "arn:aws:iam::${var.account_id}:role/oil-gas-*"
        ]
      },
      {
        Sid    = "IAMPassRoleToAWSServices"
        Effect = "Allow"
        Action = "iam:PassRole"
        Resource = [
          "arn:aws:iam::${var.account_id}:role/oil-gas-*"
        ]
        Condition = {
          StringEquals = {
            "iam:PassedToService" = [
              "glue.amazonaws.com",
              "firehose.amazonaws.com"
            ]
          }
        }
      },
      {
        Sid    = "IAMPolicyManagement"
        Effect = "Allow"
        Action = [
          "iam:CreatePolicy",
          "iam:DeletePolicy",
          "iam:GetPolicy",
          "iam:GetPolicyVersion",
          "iam:ListPolicyVersions",
          "iam:CreatePolicyVersion",
          "iam:DeletePolicyVersion",
          "iam:TagPolicy",
          "iam:UntagPolicy",
          "iam:ListPolicyTags",
          "iam:AttachUserPolicy",
          "iam:DetachUserPolicy",
          "iam:ListAttachedUserPolicies"
        ]
        Resource = [
          "arn:aws:iam::${var.account_id}:policy/oil-gas-*",
          "arn:aws:iam::${var.account_id}:user/oil-gas-*"
        ]
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:DeleteLogGroup",
          "logs:DescribeLogGroups",
          "logs:PutRetentionPolicy",
          "logs:DeleteRetentionPolicy",
          "logs:TagResource",
          "logs:UntagResource",
          "logs:ListTagsForResource",
          "logs:CreateLogStream",
          "logs:DeleteLogStream",
          "logs:DescribeLogStreams",
          "logs:PutLogEvents"
        ]
        Resource = "*"
      },
      {
        Sid    = "QuickSight"
        Effect = "Allow"
        Action = [
          "quicksight:DescribeAccountSubscription",
          "quicksight:DescribeUser",
          "quicksight:ListUsers",
          "quicksight:RegisterUser",
          "quicksight:UpdateUser",
          "quicksight:DeleteUser",
          "quicksight:CreateDataSource",
          "quicksight:DescribeDataSource",
          "quicksight:UpdateDataSource",
          "quicksight:DeleteDataSource",
          "quicksight:ListDataSources",
          "quicksight:CreateDataSet",
          "quicksight:DescribeDataSet",
          "quicksight:UpdateDataSet",
          "quicksight:DeleteDataSet",
          "quicksight:ListDataSets",
          "quicksight:DescribeDataSetRefreshProperties",
          "quicksight:PutDataSetRefreshProperties",
          "quicksight:DescribeDataSetPermissions",
          "quicksight:UpdateDataSetPermissions",
          "quicksight:TagResource",
          "quicksight:UntagResource",
          "quicksight:ListTagsForResource"
        ]
        Resource = "*"
      }
    ]
  })
}

output "deploy_policy_arn" {
  description = "ARN of the documented deploy policy. Attach to a dedicated admin user — not to oil-gas-dev."
  value       = aws_iam_policy.deploy.arn
}
