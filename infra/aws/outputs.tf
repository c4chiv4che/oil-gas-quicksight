output "raw_bucket"           { value = aws_s3_bucket.raw.id }
output "curated_bucket"       { value = aws_s3_bucket.curated.id }
output "athena_results_bucket"{ value = aws_s3_bucket.athena_results.id }
output "glue_database"        { value = aws_glue_catalog_database.oil_gas.name }
output "glue_crawler"         { value = aws_glue_crawler.wells.name }
output "athena_workgroup"     { value = aws_athena_workgroup.oil_gas.name }
# output "timestream_database"  { value = aws_timestreamwrite_database.oil_gas.database_name }
# output "timestream_table"     { value = aws_timestreamwrite_table.well_signals.table_name }
