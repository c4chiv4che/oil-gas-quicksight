# ─── KINESIS DATA STREAM (wells layer, MVP) ──────────────────────────────────
#
# Single-shard stream for streaming wells telemetry. The simulator producer
# writes records with PutRecord*; Firehose consumes and lands Parquet in S3.

resource "aws_kinesis_stream" "wells" {
  name             = "${var.project}-wells-stream"
  shard_count      = 1
  retention_period = 24
}

# ─── IAM ROLE FOR FIREHOSE ───────────────────────────────────────────────────
#
# Separate from aws_iam_role.glue. Firehose needs read on the Kinesis stream,
# write on the raw bucket under /streaming/*, read on the Glue wells table
# (for the JSON→Parquet schema conversion), and CloudWatch Logs for error
# delivery.

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
  name = "firehose-wells-access"
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
        Resource = aws_kinesis_stream.wells.arn
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
        Resource = [
          "arn:aws:glue:${var.region}:${var.account_id}:catalog",
          "arn:aws:glue:${var.region}:${var.account_id}:database/${aws_glue_catalog_database.oil_gas.name}",
          "arn:aws:glue:${var.region}:${var.account_id}:table/${aws_glue_catalog_database.oil_gas.name}/wells"
        ]
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

resource "aws_cloudwatch_log_group" "firehose_wells" {
  name              = "/aws/kinesisfirehose/${var.project}-wells-firehose"
  retention_in_days = 7
}

resource "aws_cloudwatch_log_stream" "firehose_wells_s3" {
  name           = "S3Delivery"
  log_group_name = aws_cloudwatch_log_group.firehose_wells.name
}

# ─── KINESIS FIREHOSE DELIVERY STREAM ────────────────────────────────────────
#
# Consumes the wells Kinesis stream, buffers, converts JSON → Parquet using
# the oil_gas_db.wells Glue table schema, and writes date-partitioned objects
# under s3://<raw>/streaming/wells/. Pre-apply requirement: the
# vaca-muerta-crawler must have produced oil_gas_db.wells at least once.

resource "aws_kinesis_firehose_delivery_stream" "wells" {
  name        = "${var.project}-wells-firehose"
  destination = "extended_s3"

  kinesis_source_configuration {
    kinesis_stream_arn = aws_kinesis_stream.wells.arn
    role_arn           = aws_iam_role.firehose.arn
  }

  extended_s3_configuration {
    role_arn            = aws_iam_role.firehose.arn
    bucket_arn          = aws_s3_bucket.raw.arn
    prefix              = "streaming/wells/date=!{timestamp:yyyy-MM-dd}/"
    error_output_prefix = "streaming/wells_errors/!{firehose:error-output-type}/date=!{timestamp:yyyy-MM-dd}/"
    buffering_size      = 64
    buffering_interval  = 60

    cloudwatch_logging_options {
      enabled         = true
      log_group_name  = aws_cloudwatch_log_group.firehose_wells.name
      log_stream_name = aws_cloudwatch_log_stream.firehose_wells_s3.name
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
        table_name    = "wells"
        role_arn      = aws_iam_role.firehose.arn
        region        = var.region
      }
    }
  }

  depends_on = [aws_iam_role_policy.firehose]
}

# ─── GLUE CRAWLER FOR STREAMING WELLS ────────────────────────────────────────
#
# Separate from vaca-muerta-crawler so batch wells (s3://…/wells/) and
# streaming wells (s3://…/streaming/wells/) stay in distinct tables.
# Produces oil_gas_db.streaming_wells (table_prefix forces the streaming_ name).

resource "aws_glue_crawler" "streaming_wells" {
  name          = "${var.project}-streaming-wells-crawler"
  database_name = aws_glue_catalog_database.oil_gas.name
  role          = aws_iam_role.glue.arn
  description   = "Crawls Firehose-landed Parquet under s3://<raw>/streaming/wells/"
  table_prefix  = "streaming_"

  s3_target {
    path = "s3://${aws_s3_bucket.raw.id}/streaming/wells/"
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
