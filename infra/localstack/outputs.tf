output "raw_bucket" {
  value       = aws_s3_bucket.raw.id
  description = "Bucket S3 para datos crudos del simulador"
}

output "curated_bucket" {
  value       = aws_s3_bucket.curated.id
  description = "Bucket S3 para datos procesados"
}
