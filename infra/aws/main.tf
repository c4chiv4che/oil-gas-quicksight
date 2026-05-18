# ─── S3 ──────────────────────────────────────────────────────────────────────

resource "aws_s3_bucket" "raw" {
  bucket = "${var.project}-raw-${var.account_id}"
}

resource "aws_s3_bucket" "curated" {
  bucket = "${var.project}-curated-${var.account_id}"
}

resource "aws_s3_bucket" "athena_results" {
  bucket = "${var.project}-athena-results-${var.account_id}"
}

resource "aws_s3_bucket_versioning" "raw" {
  bucket = aws_s3_bucket.raw.id
  versioning_configuration { status = "Enabled" }
}

# ─── IAM ROLE PARA GLUE ──────────────────────────────────────────────────────

resource "aws_iam_role" "glue" {
  name = "oil-gas-glue-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "glue.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy_attachment" "glue_service" {
  role       = aws_iam_role.glue.name
  policy_arn = "arn:aws:iam::aws:policy/service-role/AWSGlueServiceRole"
}

resource "aws_iam_role_policy" "glue_s3" {
  name = "glue-s3-access"
  role = aws_iam_role.glue.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Action = ["s3:GetObject", "s3:PutObject", "s3:ListBucket"]
      Resource = [
        aws_s3_bucket.raw.arn,
        "${aws_s3_bucket.raw.arn}/*",
        aws_s3_bucket.athena_results.arn,
        "${aws_s3_bucket.athena_results.arn}/*"
      ]
    }]
  })
}

# ─── GLUE DATA CATALOG ───────────────────────────────────────────────────────

resource "aws_glue_catalog_database" "oil_gas" {
  name        = "oil_gas_db"
  description = "Vaca Muerta pad data catalog"
}

resource "aws_glue_crawler" "wells" {
  name          = "wells-crawler"
  database_name = aws_glue_catalog_database.oil_gas.name
  role          = aws_iam_role.glue.arn
  description   = "Crawls Vaca Muerta well Parquet data from S3"

  s3_target {
    path = "s3://${aws_s3_bucket.raw.id}/wells/"
  }

  schema_change_policy {
    delete_behavior = "LOG"
    update_behavior = "UPDATE_IN_DATABASE"
  }

  configuration = jsonencode({
    Version = 1.0
    CrawlerOutput = {
      Partitions = { AddOrUpdateBehavior = "InheritFromTable" }
    }
  })
}

# ─── ATHENA ──────────────────────────────────────────────────────────────────

resource "aws_athena_workgroup" "oil_gas" {
  name        = "oil-gas-wg"
  description = "Workgroup para queries de O&G"

  configuration {
    enforce_workgroup_configuration    = true
    publish_cloudwatch_metrics_enabled = true
    result_configuration {
      output_location = "s3://${aws_s3_bucket.athena_results.bucket}/results/"
    }
  }
}

## ─── TIMESTREAM ──────────────────────────────────────────────────────────────

## resource "aws_timestreamwrite_database" "oil_gas" {
 # database_name = "oil-gas-db"
#}

## resource "aws_timestreamwrite_table" "well_signals" {
## database_name = aws_timestreamwrite_database.oil_gas.database_name
 # table_name    = "well-signals"

  #retention_properties {
   # memory_store_retention_period_in_hours = 24      # 1 día en memoria (más rápido/caro)
    #magnetic_store_retention_period_in_days = 365    # 1 año en disco (más barato)
  #}

  #magnetic_store_write_properties {
    #enable_magnetic_store_writes = true
  #}
#}
