---
name: QuickSight DescribeDataSetRefreshProperties permission bug
about: Reference issue for the IAM action that is not honored by quicksight:*
title: "[BUG] terraform apply fails on QuickSight DescribeDataSetRefreshProperties (403)"
labels: bug, aws, quicksight, terraform
assignees: ''
---

## Summary

`terraform apply` against any `aws_quicksight_data_set` resource fails during
the refresh-read phase with a 403 on
`quicksight:DescribeDataSetRefreshProperties`, even when the IAM user has
`quicksight:*` (or the action listed explicitly) in an inline policy. The
action appears to be **not honored by the `quicksight:*` wildcard**, and
attempts to grant it directly to a non-admin IAM user (`oil-gas-dev`) have
been unsuccessful.

## Exact error (verbatim)

```
Error: reading QuickSight Data Set (919064997947,wells) refresh properties:
operation error QuickSight: DescribeDataSetRefreshProperties, https response
error StatusCode: 403, AccessDeniedException: User: arn:aws:iam::919064997947:
user/oil-gas-dev is not authorized to perform:
quicksight:DescribeDataSetRefreshProperties on resource:
arn:aws:quicksight:us-east-1:919064997947:dataset/wells because no
identity-based policy allows the quicksight:DescribeDataSetRefreshProperties
action

  with aws_quicksight_data_set.wells,
  on quicksight.tf line 127, in resource "aws_quicksight_data_set" "wells":
 127: resource "aws_quicksight_data_set" "wells" {
```

## Environment

- AWS provider: `hashicorp/aws ~> 5.70`
- Terraform: `>= 1.5`
- Region: `us-east-1`
- QuickSight edition: **Standard** (not Enterprise — and not changing)
- IAM principal: `arn:aws:iam::919064997947:user/oil-gas-dev` (service-scoped)

## What was tried

1. Granting `quicksight:*` via inline policy → still fails.
2. Listing `quicksight:DescribeDataSetRefreshProperties` explicitly in
   `oil-gas-quicksight-author` policy → still fails.
3. Re-running with `terraform apply -refresh-only` → same error.

## Workaround (currently in use)

Skip the refresh phase entirely:

```bash
cd infra/aws && terraform apply -refresh=false -auto-approve
```

This is baked into the `tf-apply` Make target. The drift cost is acceptable
for this lab — the only state we cannot read is the dataset's refresh
schedule, which is managed through the QuickSight console anyway.

## AWS reference

- API doc:
  https://docs.aws.amazon.com/quicksight/latest/APIReference/API_DescribeDataSetRefreshProperties.html

The doc lists the action but does not call out any wildcard-coverage caveat.
Likely an AWS-side IAM coverage gap; revisit periodically.

## Notes

- **Do NOT** propose upgrading to QuickSight Enterprise as a fix — Standard
  is a deliberate choice for this account.
- See `tf-apply` in the repo root `Makefile` for the workaround in context.
