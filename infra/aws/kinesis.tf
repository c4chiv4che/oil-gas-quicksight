# ─── KINESIS STREAMING PIPELINE (wells + plant + utilities) ──────────────────
#
# Three Kinesis Data Streams (1 shard, 24h retention each) fed by the
# simulator producer; one Firehose per stream that buffers, converts
# JSON → Parquet using the matching Glue table schema (oil_gas_db.<layer>),
# and lands date-partitioned objects under s3://<raw>/streaming/<layer>/.
# A dedicated streaming crawler per layer produces oil_gas_db.streaming_<layer>,
# kept distinct from the batch tables so partition layouts can diverge.
#
# Driven by locals.streaming_layers = toset(["wells","plant","utilities"]).
# A single IAM role (oil-gas-firehose-role) is scoped to all three stream
# ARNs, all three Glue tables, and the s3://<raw>/streaming/* prefix.
#
# COST MODEL — read before applying.
# ~$11/mo per stream if left running 24/7 → ~$33/mo for the 3 streams combined
# (excluding Firehose ingestion + S3 storage + CloudWatch Logs). This is a
# portfolio lab, not a production workload. Intended pattern: apply on-demand
# for a demo, then destroy. Targeted destroy when you're done:
#   terraform destroy -target='aws_kinesis_firehose_delivery_stream.layer'
#   terraform destroy -target='aws_kinesis_stream.layer'
#   terraform destroy -target='aws_glue_crawler.streaming_layer'
#   terraform destroy -target='aws_cloudwatch_log_stream.firehose_layer_s3'
#   terraform destroy -target='aws_cloudwatch_log_group.firehose_layer'
#   terraform destroy -target='aws_iam_role_policy.firehose'
#   terraform destroy -target='aws_iam_role.firehose'
#
# Pre-apply requirement: oil_gas_db.wells, oil_gas_db.plant, and
# oil_gas_db.utilities must exist (Firehose's JSON→Parquet conversion reads
# the column schema from Glue). The vaca-muerta-crawler builds them from the
# batch S3 prefixes — run it at least once before applying this file.

locals {
  streaming_layers = toset(["wells", "plant", "utilities"])
}

# ─── KINESIS DATA STREAMS ────────────────────────────────────────────────────

resource "aws_kinesis_stream" "layer" {
  for_each         = local.streaming_layers
  name             = "${var.project}-${each.key}-stream"
  shard_count      = 1
  retention_period = 24
}

# ─── SHARED IAM ROLE FOR FIREHOSE ────────────────────────────────────────────
#
# Separate from aws_iam_role.glue. Firehose needs read on each Kinesis stream,
# write on the raw bucket under /streaming/*, read on the three Glue tables
# (for JSON→Parquet schema conversion), and CloudWatch Logs for error delivery.

resource "aws_iam_role" "firehose" {
  name = "oil-gas-firehose-role"
  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action    = "sts:AssumeRole"
      Effect    = "Allow"
      Principal = { Service = "firehose.amazonaws.com" }
    }]
  })
}

resource "aws_iam_role_policy" "firehose" {
  name = "firehose-streaming-access"
  role = aws_iam_role.firehose.id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Sid    = "KinesisSource"
        Effect = "Allow"
        Action = [
          "kinesis:DescribeStream",
          "kinesis:GetShardIterator",
          "kinesis:GetRecords",
          "kinesis:ListShards"
        ]
        Resource = [for s in aws_kinesis_stream.layer : s.arn]
      },
      {
        Sid    = "S3Destination"
        Effect = "Allow"
        Action = [
          "s3:AbortMultipartUpload",
          "s3:GetBucketLocation",
          "s3:GetObject",
          "s3:ListBucket",
          "s3:PutObject"
        ]
        Resource = [
          aws_s3_bucket.raw.arn,
          "${aws_s3_bucket.raw.arn}/streaming/*"
        ]
      },
      {
        Sid    = "GlueSchemaForParquetConversion"
        Effect = "Allow"
        Action = [
          "glue:GetTable",
          "glue:GetTableVersion",
          "glue:GetTableVersions"
        ]
        Resource = concat(
          [
            "arn:aws:glue:${var.region}:${var.account_id}:catalog",
            "arn:aws:glue:${var.region}:${var.account_id}:database/${aws_glue_catalog_database.oil_gas.name}",
          ],
          [for l in local.streaming_layers : "arn:aws:glue:${var.region}:${var.account_id}:table/${aws_glue_catalog_database.oil_gas.name}/${l}"]
        )
      },
      {
        Sid    = "CloudWatchLogs"
        Effect = "Allow"
        Action = [
          "logs:CreateLogGroup",
          "logs:CreateLogStream",
          "logs:PutLogEvents"
        ]
        Resource = "arn:aws:logs:${var.region}:${var.account_id}:log-group:/aws/kinesisfirehose/*"
      }
    ]
  })
}

# ─── CLOUDWATCH LOGGING FOR FIREHOSE ─────────────────────────────────────────

resource "aws_cloudwatch_log_group" "firehose_layer" {
  for_each          = local.streaming_layers
  name              = "/aws/kinesisfirehose/${var.project}-${each.key}-firehose"
  retention_in_days = 7
}

resource "aws_cloudwatch_log_stream" "firehose_layer_s3" {
  for_each       = local.streaming_layers
  name           = "S3Delivery"
  log_group_name = aws_cloudwatch_log_group.firehose_layer[each.key].name
}

# ─── KINESIS FIREHOSE DELIVERY STREAMS ───────────────────────────────────────
#
# One Firehose per layer. Each consumes its Kinesis stream, buffers, converts
# JSON → Parquet using the matching oil_gas_db.<layer> Glue table schema, and
# writes date-partitioned objects under s3://<raw>/streaming/<layer>/.

resource "aws_kinesis_firehose_delivery_stream" "layer" {
  for_each    = local.streaming_layers
  name        = "${var.project}-${each.key}-firehose"
  destination = "extended_s3"

  kinesis_source_configuration {
    kinesis_stream_arn = aws_kinesis_stream.layer[each.key].arn
    role_arn           = aws_iam_role.firehose.arn
  }

  extended_s3_configuration {
    role_arn            = aws_iam_role.firehose.arn
    bucket_arn          = aws_s3_bucket.raw.arn
    prefix              = "streaming/${each.key}/date=!{timestamp:yyyy-MM-dd}/"
    error_output_prefix = "streaming/${each.key}_errors/!{firehose:error-output-type}/date=!{timestamp:yyyy-MM-dd}/"
    buffering_size      = 64
    buffering_interval  = 60

    cloudwatch_logging_options {
      enabled         = true
      log_group_name  = aws_cloudwatch_log_group.firehose_layer[each.key].name
      log_stream_name = aws_cloudwatch_log_stream.firehose_layer_s3[each.key].name
    }

    data_format_conversion_configuration {
      enabled = true

      input_format_configuration {
        deserializer {
          open_x_json_ser_de {}
        }
      }

      output_format_configuration {
        serializer {
          parquet_ser_de {}
        }
      }

      schema_configuration {
        database_name = aws_glue_catalog_database.oil_gas.name
        table_name    = each.key
        role_arn      = aws_iam_role.firehose.arn
        region        = var.region
      }
    }
  }

  depends_on = [aws_iam_role_policy.firehose]
}

# ─── GLUE CRAWLERS FOR STREAMING DATA ────────────────────────────────────────
#
# One crawler per layer, all writing into oil_gas_db but keeping streaming
# tables distinct from batch tables via the streaming_ prefix
# (streaming_wells / streaming_plant / streaming_utilities). Prevents batch
# (s3://…/<layer>/) and streaming (s3://…/streaming/<layer>/) prefixes from
# colliding under the same Glue table when partition layouts differ.

resource "aws_glue_crawler" "streaming_layer" {
  for_each      = local.streaming_layers
  name          = "${var.project}-streaming-${each.key}-crawler"
  database_name = aws_glue_catalog_database.oil_gas.name
  role          = aws_iam_role.glue.arn
  description   = "Crawls Firehose-landed Parquet under s3://<raw>/streaming/${each.key}/"
  table_prefix  = "streaming_"

  s3_target {
    path = "s3://${aws_s3_bucket.raw.id}/streaming/${each.key}/"
  }

  schema_change_policy {
    delete_behavior = "DELETE_FROM_DATABASE"
    update_behavior = "UPDATE_IN_DATABASE"
  }

  recrawl_policy {
    recrawl_behavior = "CRAWL_EVERYTHING"
  }

  configuration = jsonencode({
    Version = 1.0
    CrawlerOutput = {
      Partitions = { AddOrUpdateBehavior = "InheritFromTable" }
    }
  })
}
