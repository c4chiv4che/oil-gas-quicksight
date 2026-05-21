output "raw_bucket" { value = aws_s3_bucket.raw.id }
output "curated_bucket" { value = aws_s3_bucket.curated.id }
output "athena_results_bucket" { value = aws_s3_bucket.athena_results.id }
output "glue_database" { value = aws_glue_catalog_database.oil_gas.name }
output "glue_crawler" { value = aws_glue_crawler.vaca_muerta.name }
output "athena_workgroup" { value = aws_athena_workgroup.oil_gas.name }
output "streaming_stream_names" {
  description = "Map of layer → Kinesis stream name (wells/plant/utilities)."
  value       = { for k, s in aws_kinesis_stream.layer : k => s.name }
}
output "streaming_stream_arns" {
  description = "Map of layer → Kinesis stream ARN."
  value       = { for k, s in aws_kinesis_stream.layer : k => s.arn }
}
output "streaming_firehose_names" {
  description = "Map of layer → Firehose delivery stream name."
  value       = { for k, f in aws_kinesis_firehose_delivery_stream.layer : k => f.name }
}
output "streaming_crawler_names" {
  description = "Map of layer → Glue crawler name for the streaming_<layer> table."
  value       = { for k, c in aws_glue_crawler.streaming_layer : k => c.name }
}
output "runtime_policy_arn" {
  description = "ARN of the oil-gas-dev runtime managed policy (attached to oil-gas-dev). Replaces the 7 legacy inline policies on that user."
  value       = aws_iam_policy.runtime.arn
}
# output "timestream_database"  { value = aws_timestreamwrite_database.oil_gas.database_name }
# output "timestream_table"     { value = aws_timestreamwrite_table.well_signals.table_name }
