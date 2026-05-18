# NOTE: QuickSight Standard is already subscribed manually for this account.
# Do NOT add aws_quicksight_account_subscription here — it would attempt to
# re-subscribe (and could push to Enterprise).

# ─── REGISTER IAM USER AS QUICKSIGHT AUTHOR ──────────────────────────────────

resource "aws_quicksight_user" "author" {
  email         = var.qs_notification_email
  identity_type = "IAM"
  user_role     = "AUTHOR"
  iam_arn       = "arn:aws:iam::${var.account_id}:user/${var.qs_iam_user_name}"
  namespace     = "default"
}

# ─── IAM POLICY FOR THE CLI USER ─────────────────────────────────────────────
#
# Scoped to actions the create_wells_analysis.sh script needs, plus enough
# read/write coverage to build datasets from Athena later. Resource = "*"
# is acceptable for a personal dev account; tighten before prod.

resource "aws_iam_policy" "quicksight_author" {
  name        = "oil-gas-quicksight-author"
  description = "QuickSight author permissions for the oil-gas lab."

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "QuickSightAuthoring"
        Effect = "Allow"
        Action = [
          "quicksight:DescribeUser",
          "quicksight:ListUsers",
          "quicksight:ListDataSources",
          "quicksight:DescribeDataSource",
          "quicksight:CreateDataSource",
          "quicksight:UpdateDataSource",
          "quicksight:PassDataSource",
          "quicksight:ListDataSets",
          "quicksight:DescribeDataSet",
          "quicksight:CreateDataSet",
          "quicksight:UpdateDataSet",
          "quicksight:PassDataSet",
          "quicksight:ListIngestions",
          "quicksight:CreateIngestion",
          "quicksight:ListAnalyses",
          "quicksight:DescribeAnalysis",
          "quicksight:DescribeAnalysisDefinition",
          "quicksight:CreateAnalysis",
          "quicksight:UpdateAnalysis",
          "quicksight:DeleteAnalysis",
          "quicksight:ListDashboards",
          "quicksight:DescribeDashboard",
          "quicksight:CreateDashboard",
          "quicksight:UpdateDashboard",
          "quicksight:DeleteDashboard",
          "quicksight:TagResource",
          "quicksight:UntagResource",
          "quicksight:ListTagsForResource"
        ]
        Resource = "*"
      },
      {
        Sid    = "AthenaForQuickSight"
        Effect = "Allow"
        Action = [
          "athena:GetWorkGroup",
          "athena:StartQueryExecution",
          "athena:GetQueryExecution",
          "athena:GetQueryResults",
          "athena:ListDatabases",
          "athena:ListTableMetadata",
          "athena:GetTableMetadata",
          "glue:GetDatabase",
          "glue:GetDatabases",
          "glue:GetTable",
          "glue:GetTables",
          "glue:GetPartitions"
        ]
        Resource = "*"
      }
    ]
  })
}

resource "aws_iam_user_policy_attachment" "quicksight_author" {
  user       = var.qs_iam_user_name
  policy_arn = aws_iam_policy.quicksight_author.arn
}

# ─── DATA SOURCE: ATHENA ─────────────────────────────────────────────────────

locals {
  qs_author_principal = aws_quicksight_user.author.arn
}

resource "aws_quicksight_data_source" "athena" {
  data_source_id = "athena-oil-gas"
  name           = "Athena (oil-gas)"
  type           = "ATHENA"

  parameters {
    athena {
      work_group = aws_athena_workgroup.oil_gas.name
    }
  }

  permission {
    principal = local.qs_author_principal
    actions = [
      "quicksight:DescribeDataSource",
      "quicksight:DescribeDataSourcePermissions",
      "quicksight:PassDataSource",
      "quicksight:UpdateDataSource",
      "quicksight:UpdateDataSourcePermissions",
      "quicksight:DeleteDataSource",
    ]
  }

  depends_on = [aws_quicksight_user.author]
}

# ─── DATA SET: wells (SPICE) ─────────────────────────────────────────────────
# Backed by oil_gas_db.wells (Glue catalog → Athena). Columns are an explicit
# subset of the crawler-discovered schema, mapped to QuickSight types.

resource "aws_quicksight_data_set" "wells" {
  data_set_id = "wells"
  name        = "wells"
  import_mode = "SPICE"

  physical_table_map {
    physical_table_map_id = "wells-physical"
    relational_table {
      data_source_arn = aws_quicksight_data_source.athena.arn
      catalog         = "AwsDataCatalog"
      schema          = aws_glue_catalog_database.oil_gas.name
      name            = "wells"

      input_columns {
        name = "timestamp"
        type = "DATETIME"
      }
      input_columns {
        name = "well_id"
        type = "STRING"
      }
      input_columns {
        name = "pad_id"
        type = "STRING"
      }
      input_columns {
        name = "state"
        type = "STRING"
      }
      input_columns {
        name = "shutdown_reason"
        type = "STRING"
      }
      input_columns {
        name = "whp_bar"
        type = "DECIMAL"
      }
      input_columns {
        name = "oil_rate_m3d"
        type = "DECIMAL"
      }
      input_columns {
        name = "gas_rate_mm3d"
        type = "DECIMAL"
      }
      input_columns {
        name = "esp_freq_hz"
        type = "DECIMAL"
      }
      input_columns {
        name = "esp_current_a"
        type = "DECIMAL"
      }
      input_columns {
        name = "watercut_frac"
        type = "DECIMAL"
      }
    }
  }

  permissions {
    principal = local.qs_author_principal
    actions = [
      "quicksight:DescribeDataSet",
      "quicksight:DescribeDataSetPermissions",
      "quicksight:PassDataSet",
      "quicksight:DescribeIngestion",
      "quicksight:ListIngestions",
      "quicksight:UpdateDataSet",
      "quicksight:UpdateDataSetPermissions",
      "quicksight:DeleteDataSet",
      "quicksight:CreateIngestion",
      "quicksight:CancelIngestion",
    ]
  }
}
