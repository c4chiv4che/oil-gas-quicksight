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
  region  = var.region
  profile = var.aws_profile

  default_tags {
    tags = {
      project = "oil-gas-quicksight"
      env     = "dev"
      owner   = "c4chiv4che"
      managed = "terraform"
      purpose   = "learning"
      repo      = "github.com/c4chiv4che/oil-gas-quicksight"
    }
  }
}
