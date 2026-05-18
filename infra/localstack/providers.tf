terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }
}

# Provider apuntado a LocalStack
provider "aws" {
  region                      = "us-east-1"
  access_key                  = "test"
  secret_key                  = "test"
  s3_use_path_style           = true
  skip_credentials_validation = true
  skip_metadata_api_check     = true
  skip_requesting_account_id  = true

  endpoints {
    s3       = "http://localhost:4566"
    iam      = "http://localhost:4566"
    lambda   = "http://localhost:4566"
    sts      = "http://localhost:4566"
    logs     = "http://localhost:4566"
    glue     = "http://localhost:4566"
    athena   = "http://localhost:4566"
  }

  default_tags {
    tags = {
      project = "oil-gas-quicksight"
      env     = "local"
      owner   = "c4chiv4che"
      managed = "terraform"
    }
  }
}
