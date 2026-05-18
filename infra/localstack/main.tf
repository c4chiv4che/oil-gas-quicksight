# Bucket para datos crudos del simulador
resource "aws_s3_bucket" "raw" {
  bucket = "vaca-muerta-raw"
}

# Bucket para datos procesados/curados
resource "aws_s3_bucket" "curated" {
  bucket = "vaca-muerta-curated"
}

# Versionado en raw — buena práctica para data lakes
resource "aws_s3_bucket_versioning" "raw" {
  bucket = aws_s3_bucket.raw.id
  versioning_configuration {
    status = "Enabled"
  }
}
