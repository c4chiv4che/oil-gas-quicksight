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

  qs_dataset_actions = [
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
# Backed by oil_gas_db.wells (Glue catalog → Athena). Columns mirror the
# crawler-discovered schema 1:1; Glue double → DECIMAL, timestamp → DATETIME.

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
        name = "pad_id"
        type = "STRING"
      }
      input_columns {
        name = "well_id"
        type = "STRING"
      }
      input_columns {
        name = "well_state"
        type = "STRING"
      }
      input_columns {
        name = "shutdown_reason"
        type = "STRING"
      }
      input_columns {
        name = "t_days_online"
        type = "DECIMAL"
      }
      input_columns {
        name = "whp"
        type = "DECIMAL"
      }
      input_columns {
        name = "chp"
        type = "DECIMAL"
      }
      input_columns {
        name = "tt_flow"
        type = "DECIMAL"
      }
      input_columns {
        name = "ft_oil"
        type = "DECIMAL"
      }
      input_columns {
        name = "ft_gas"
        type = "DECIMAL"
      }
      input_columns {
        name = "ft_water"
        type = "DECIMAL"
      }
      input_columns {
        name = "it_esp"
        type = "DECIMAL"
      }
      input_columns {
        name = "si_esp"
        type = "DECIMAL"
      }
      input_columns {
        name = "zt_choke"
        type = "DECIMAL"
      }
      input_columns {
        name = "pt_downhole"
        type = "DECIMAL"
      }
      input_columns {
        name = "ai_gor"
        type = "DECIMAL"
      }
      input_columns {
        name = "ai_wcut"
        type = "DECIMAL"
      }
      input_columns {
        name = "ai_c1"
        type = "DECIMAL"
      }
      input_columns {
        name = "ai_c2"
        type = "DECIMAL"
      }
      input_columns {
        name = "ai_c3"
        type = "DECIMAL"
      }
      input_columns {
        name = "ai_c4"
        type = "DECIMAL"
      }
      input_columns {
        name = "ai_c5_plus"
        type = "DECIMAL"
      }
      input_columns {
        name = "ai_co2"
        type = "DECIMAL"
      }
      input_columns {
        name = "ai_n2"
        type = "DECIMAL"
      }
      input_columns {
        name = "ai_h2s"
        type = "DECIMAL"
      }
      input_columns {
        name = "ai_h2o"
        type = "DECIMAL"
      }
      input_columns {
        name = "ai_sand"
        type = "DECIMAL"
      }
      input_columns {
        name = "vt_esp"
        type = "DECIMAL"
      }
      input_columns {
        name = "tt_esp_oil"
        type = "DECIMAL"
      }
      input_columns {
        name = "corrosion_risk"
        type = "DECIMAL"
      }
      input_columns {
        name = "hydrate_risk"
        type = "DECIMAL"
      }
    }
  }

  permissions {
    principal = local.qs_author_principal
    actions   = local.qs_dataset_actions
  }
}

# ─── DATA SET: plant (SPICE) ─────────────────────────────────────────────────
# Backed by oil_gas_db.plant. Inlet manifold, separation, dehydration (TEG),
# LTS/propane refrigeration, stabilization, export compression, and fiscal
# metering tags. All Glue doubles → DECIMAL.

resource "aws_quicksight_data_set" "plant" {
  data_set_id = "plant"
  name        = "plant"
  import_mode = "SPICE"

  physical_table_map {
    physical_table_map_id = "plant-physical"
    relational_table {
      data_source_arn = aws_quicksight_data_source.athena.arn
      catalog         = "AwsDataCatalog"
      schema          = aws_glue_catalog_database.oil_gas.name
      name            = "plant"

      input_columns {
        name = "timestamp"
        type = "DATETIME"
      }
      input_columns {
        name = "pad_id"
        type = "STRING"
      }
      input_columns {
        name = "plant_event"
        type = "STRING"
      }
      input_columns {
        name = "esd_phase"
        type = "STRING"
      }
      input_columns {
        name = "esd_reason"
        type = "STRING"
      }
      input_columns {
        name = "pt_inlet"
        type = "DECIMAL"
      }
      input_columns {
        name = "tt_inlet"
        type = "DECIMAL"
      }
      input_columns {
        name = "lt_slug"
        type = "DECIMAL"
      }
      input_columns {
        name = "ft_inlet_gas"
        type = "DECIMAL"
      }
      input_columns {
        name = "ft_inlet_liq"
        type = "DECIMAL"
      }
      input_columns {
        name = "pt_sep"
        type = "DECIMAL"
      }
      input_columns {
        name = "tt_sep"
        type = "DECIMAL"
      }
      input_columns {
        name = "lt_sep_oil"
        type = "DECIMAL"
      }
      input_columns {
        name = "lt_sep_water"
        type = "DECIMAL"
      }
      input_columns {
        name = "pdt_sep"
        type = "DECIMAL"
      }
      input_columns {
        name = "tt_contactor"
        type = "DECIMAL"
      }
      input_columns {
        name = "pt_contactor"
        type = "DECIMAL"
      }
      input_columns {
        name = "ft_teg_circ"
        type = "DECIMAL"
      }
      input_columns {
        name = "tt_reboiler"
        type = "DECIMAL"
      }
      input_columns {
        name = "ai_teg_purity"
        type = "DECIMAL"
      }
      input_columns {
        name = "ai_dewpoint_h2o"
        type = "DECIMAL"
      }
      input_columns {
        name = "lt_teg_surge"
        type = "DECIMAL"
      }
      input_columns {
        name = "tt_gas_gas"
        type = "DECIMAL"
      }
      input_columns {
        name = "tt_chiller"
        type = "DECIMAL"
      }
      input_columns {
        name = "pt_lts"
        type = "DECIMAL"
      }
      input_columns {
        name = "tt_lts"
        type = "DECIMAL"
      }
      input_columns {
        name = "lt_lts"
        type = "DECIMAL"
      }
      input_columns {
        name = "ai_dewpoint_hc"
        type = "DECIMAL"
      }
      input_columns {
        name = "pt_prop_suct"
        type = "DECIMAL"
      }
      input_columns {
        name = "pt_prop_disch"
        type = "DECIMAL"
      }
      input_columns {
        name = "tt_prop_suct"
        type = "DECIMAL"
      }
      input_columns {
        name = "tt_prop_disch"
        type = "DECIMAL"
      }
      input_columns {
        name = "si_prop_comp"
        type = "DECIMAL"
      }
      input_columns {
        name = "it_prop_comp"
        type = "DECIMAL"
      }
      input_columns {
        name = "vt_prop_comp"
        type = "DECIMAL"
      }
      input_columns {
        name = "lt_prop_acum"
        type = "DECIMAL"
      }
      input_columns {
        name = "pt_stab"
        type = "DECIMAL"
      }
      input_columns {
        name = "tt_stab_top"
        type = "DECIMAL"
      }
      input_columns {
        name = "tt_stab_bot"
        type = "DECIMAL"
      }
      input_columns {
        name = "ft_cond_out"
        type = "DECIMAL"
      }
      input_columns {
        name = "ai_rvp"
        type = "DECIMAL"
      }
      input_columns {
        name = "pt_comp_suct"
        type = "DECIMAL"
      }
      input_columns {
        name = "pt_comp_disch"
        type = "DECIMAL"
      }
      input_columns {
        name = "tt_comp_suct"
        type = "DECIMAL"
      }
      input_columns {
        name = "tt_comp_disch"
        type = "DECIMAL"
      }
      input_columns {
        name = "si_comp"
        type = "DECIMAL"
      }
      input_columns {
        name = "vt_comp"
        type = "DECIMAL"
      }
      input_columns {
        name = "zt_antisurge"
        type = "DECIMAL"
      }
      input_columns {
        name = "ft_recycle"
        type = "DECIMAL"
      }
      input_columns {
        name = "fqi_gas_fiscal"
        type = "DECIMAL"
      }
      input_columns {
        name = "fqi_cond_fiscal"
        type = "DECIMAL"
      }
      input_columns {
        name = "ai_pcs"
        type = "DECIMAL"
      }
      input_columns {
        name = "ai_wobbe"
        type = "DECIMAL"
      }
      input_columns {
        name = "ai_density"
        type = "DECIMAL"
      }
      input_columns {
        name = "ai_dew_hc_fiscal"
        type = "DECIMAL"
      }
      input_columns {
        name = "ai_h2o_fiscal"
        type = "DECIMAL"
      }
      input_columns {
        name = "ai_h2s_fiscal"
        type = "DECIMAL"
      }
      input_columns {
        name = "ai_s_total"
        type = "DECIMAL"
      }
      input_columns {
        name = "ai_co2_fiscal"
        type = "DECIMAL"
      }
      input_columns {
        name = "ai_o2_fiscal"
        type = "DECIMAL"
      }
    }
  }

  permissions {
    principal = local.qs_author_principal
    actions   = local.qs_dataset_actions
  }
}

# ─── DATA SET: utilities (SPICE) ─────────────────────────────────────────────
# Backed by oil_gas_db.utilities. Hot-oil loop, instrument air header, flare
# HP/LP + KO drum, smoke quality. All Glue doubles → DECIMAL.

resource "aws_quicksight_data_set" "utilities" {
  data_set_id = "utilities"
  name        = "utilities"
  import_mode = "SPICE"

  physical_table_map {
    physical_table_map_id = "utilities-physical"
    relational_table {
      data_source_arn = aws_quicksight_data_source.athena.arn
      catalog         = "AwsDataCatalog"
      schema          = aws_glue_catalog_database.oil_gas.name
      name            = "utilities"

      input_columns {
        name = "timestamp"
        type = "DATETIME"
      }
      input_columns {
        name = "pad_id"
        type = "STRING"
      }
      input_columns {
        name = "esd_phase"
        type = "STRING"
      }
      input_columns {
        name = "esd_reason"
        type = "STRING"
      }
      input_columns {
        name = "tt_hotoil_supply"
        type = "DECIMAL"
      }
      input_columns {
        name = "tt_hotoil_return"
        type = "DECIMAL"
      }
      input_columns {
        name = "pt_hotoil"
        type = "DECIMAL"
      }
      input_columns {
        name = "ft_hotoil"
        type = "DECIMAL"
      }
      input_columns {
        name = "tt_heater_stack"
        type = "DECIMAL"
      }
      input_columns {
        name = "ai_o2_stack"
        type = "DECIMAL"
      }
      input_columns {
        name = "zt_fuel_valve"
        type = "DECIMAL"
      }
      input_columns {
        name = "pt_ia_header"
        type = "DECIMAL"
      }
      input_columns {
        name = "tt_ia_dewpoint"
        type = "DECIMAL"
      }
      input_columns {
        name = "lt_ia_accum"
        type = "DECIMAL"
      }
      input_columns {
        name = "ft_flare_hp"
        type = "DECIMAL"
      }
      input_columns {
        name = "ft_flare_lp"
        type = "DECIMAL"
      }
      input_columns {
        name = "tt_flare_pilot"
        type = "DECIMAL"
      }
      input_columns {
        name = "pt_ko_drum"
        type = "DECIMAL"
      }
      input_columns {
        name = "lt_ko_drum"
        type = "DECIMAL"
      }
      input_columns {
        name = "qi_flare_smoke"
        type = "DECIMAL"
      }
    }
  }

  permissions {
    principal = local.qs_author_principal
    actions   = local.qs_dataset_actions
  }
}
