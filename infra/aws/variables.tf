variable "aws_profile" {
  description = "AWS CLI profile used by the Terraform provider. Override (e.g. TF_VAR_aws_profile=oil-gas-admin) for one-off privileged bootstraps."
  default     = "oil-gas-dev"
}

variable "account_id" {
  default = "919064997947"
}

variable "region" {
  default = "us-east-1"
}

variable "project" {
  default = "vaca-muerta"
}

# ─── QuickSight ──────────────────────────────────────────────────────────────
# Account is already subscribed (STANDARD edition) — subscription managed
# outside Terraform.

variable "qs_notification_email" {
  description = "Email used when registering the IAM user as a QuickSight author."
  default     = "your.email@example.com"
}

variable "qs_iam_user_name" {
  description = "IAM user that becomes a QuickSight AUTHOR."
  default     = "oil-gas-dev"
}
