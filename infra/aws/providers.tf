terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.70"
    }
  }
}

provider "aws" {
  region  = "us-east-1"
  profile = "oil-gas-dev"

  default_tags {
    tags = {
      project = "oil-gas-quicksight"
      env     = "dev"
      owner   = "c4chiv4che"
      managed = "terraform"
    }
  }
}
