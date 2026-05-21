output "raw_bucket" { value = aws_s3_bucket.raw.id }
output "curated_bucket" { value = aws_s3_bucket.curated.id }
output "athena_results_bucket" { value = aws_s3_bucket.athena_results.id }
output "glue_database" { value = aws_glue_catalog_database.oil_gas.name }
output "glue_crawler" { value = aws_glue_crawler.vaca_muerta.name }
output "athena_workgroup" { value = aws_athena_workgroup.oil_gas.name }
output "wells_stream_name" { value = aws_kinesis_stream.wells.name }
output "wells_stream_arn" { value = aws_kinesis_stream.wells.arn }
output "wells_firehose_name" { value = aws_kinesis_firehose_delivery_stream.wells.name }
output "runtime_policy_arn" {
  description = "ARN of the oil-gas-dev runtime managed policy (attached to oil-gas-dev). Replaces the 7 legacy inline policies on that user."
  value       = aws_iam_policy.runtime.arn
}
# output "timestream_database"  { value = aws_timestreamwrite_database.oil_gas.database_name }
# output "timestream_table"     { value = aws_timestreamwrite_table.well_signals.table_name }
