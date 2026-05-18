#!/usr/bin/env bash
#
# Create the "Oil & Gas — Wells Production" QuickSight analysis.
#
# Prereqs:
#   - AWS CLI v2, profile `oil-gas-dev` configured for account 919064997947
#   - A SPICE dataset named "wells" already imported in QuickSight
#     with these columns (matching types):
#       timestamp (datetime), well_id (string),
#       oil_rate_m3d, gas_rate_mm3d, whp_bar, esp_freq_hz,
#       esp_current_a, watercut_frac (all decimal),
#       state, shutdown_reason (string)
#
# Usage:
#   ./create_wells_analysis.sh [DATASET_ID]
#
# If DATASET_ID is omitted, the script resolves it by name ("wells").

set -euo pipefail

AWS_ACCOUNT_ID="919064997947"
AWS_REGION="us-east-1"
AWS_PROFILE="oil-gas-dev"

ANALYSIS_ID="oil-gas-wells-analysis"
ANALYSIS_NAME="Oil & Gas — Wells Production"
DATASET_NAME="wells"

aws_qs() {
  aws quicksight "$@" \
    --region "$AWS_REGION" \
    --profile "$AWS_PROFILE"
}

# -----------------------------------------------------------------------------
# 1. Resolve the DatasetArn
# -----------------------------------------------------------------------------
# Equivalent one-liner to inspect manually:
#
#   aws quicksight list-data-sets \
#     --aws-account-id 919064997947 \
#     --region us-east-1 --profile oil-gas-dev \
#     --query "DataSetSummaries[?Name=='wells'].{Id:DataSetId,Arn:Arn}"
#
# Or, if you already know the DataSetId:
#
#   aws quicksight describe-data-set \
#     --aws-account-id 919064997947 \
#     --data-set-id <DATASET_ID> \
#     --region us-east-1 --profile oil-gas-dev \
#     --query "DataSet.Arn" --output text
#
if [[ $# -ge 1 ]]; then
  DATASET_ID="$1"
else
  DATASET_ID="$(
    aws_qs list-data-sets \
      --aws-account-id "$AWS_ACCOUNT_ID" \
      --query "DataSetSummaries[?Name=='${DATASET_NAME}'] | [0].DataSetId" \
      --output text
  )"
fi

if [[ -z "${DATASET_ID:-}" || "$DATASET_ID" == "None" ]]; then
  echo "ERROR: could not find a QuickSight dataset named '${DATASET_NAME}'." >&2
  exit 1
fi

DATASET_ARN="$(
  aws_qs describe-data-set \
    --aws-account-id "$AWS_ACCOUNT_ID" \
    --data-set-id "$DATASET_ID" \
    --query "DataSet.Arn" \
    --output text
)"

echo "Using DataSetId : $DATASET_ID"
echo "Using DataSetArn: $DATASET_ARN"

# -----------------------------------------------------------------------------
# 2. Build the analysis definition
# -----------------------------------------------------------------------------
DEF_FILE="$(mktemp -t wells_analysis_def.XXXXXX.json)"
trap 'rm -f "$DEF_FILE"' EXIT

cat > "$DEF_FILE" <<JSON
{
  "DataSetIdentifierDeclarations": [
    {
      "Identifier": "wells",
      "DataSetArn": "${DATASET_ARN}"
    }
  ],
  "Sheets": [
    {
      "SheetId": "sheet-production",
      "Name": "Production",
      "Visuals": [
        {
          "LineChartVisual": {
            "VisualId": "vis-decline-curve",
            "Title": {
              "Visibility": "VISIBLE",
              "FormatText": { "PlainText": "Decline Curve PAD LLL-01" }
            },
            "ChartConfiguration": {
              "FieldWells": {
                "LineChartAggregatedFieldWells": {
                  "Category": [
                    {
                      "DateDimensionField": {
                        "FieldId": "decline.timestamp",
                        "Column": {
                          "DataSetIdentifier": "wells",
                          "ColumnName": "timestamp"
                        },
                        "DateGranularity": "DAY"
                      }
                    }
                  ],
                  "Values": [
                    {
                      "NumericalMeasureField": {
                        "FieldId": "decline.oil_rate_median",
                        "Column": {
                          "DataSetIdentifier": "wells",
                          "ColumnName": "oil_rate_m3d"
                        },
                        "AggregationFunction": {
                          "SimpleNumericalAggregation": "MEDIAN"
                        }
                      }
                    }
                  ],
                  "Colors": [
                    {
                      "CategoricalDimensionField": {
                        "FieldId": "decline.well_id",
                        "Column": {
                          "DataSetIdentifier": "wells",
                          "ColumnName": "well_id"
                        }
                      }
                    }
                  ]
                }
              },
              "Type": "LINE"
            }
          }
        },
        {
          "LineChartVisual": {
            "VisualId": "vis-whp",
            "Title": {
              "Visibility": "VISIBLE",
              "FormatText": { "PlainText": "Wellhead Pressure" }
            },
            "ChartConfiguration": {
              "FieldWells": {
                "LineChartAggregatedFieldWells": {
                  "Category": [
                    {
                      "DateDimensionField": {
                        "FieldId": "whp.timestamp",
                        "Column": {
                          "DataSetIdentifier": "wells",
                          "ColumnName": "timestamp"
                        },
                        "DateGranularity": "DAY"
                      }
                    }
                  ],
                  "Values": [
                    {
                      "NumericalMeasureField": {
                        "FieldId": "whp.avg",
                        "Column": {
                          "DataSetIdentifier": "wells",
                          "ColumnName": "whp_bar"
                        },
                        "AggregationFunction": {
                          "SimpleNumericalAggregation": "AVERAGE"
                        }
                      }
                    }
                  ],
                  "Colors": [
                    {
                      "CategoricalDimensionField": {
                        "FieldId": "whp.well_id",
                        "Column": {
                          "DataSetIdentifier": "wells",
                          "ColumnName": "well_id"
                        }
                      }
                    }
                  ]
                }
              },
              "Type": "LINE"
            }
          }
        },
        {
          "KPIVisual": {
            "VisualId": "vis-total-prod",
            "Title": {
              "Visibility": "VISIBLE",
              "FormatText": { "PlainText": "Total PAD Production m³" }
            },
            "ChartConfiguration": {
              "FieldWells": {
                "Values": [
                  {
                    "NumericalMeasureField": {
                      "FieldId": "kpi.oil_total",
                      "Column": {
                        "DataSetIdentifier": "wells",
                        "ColumnName": "oil_rate_m3d"
                      },
                      "AggregationFunction": {
                        "SimpleNumericalAggregation": "SUM"
                      }
                    }
                  }
                ]
              },
              "KPIOptions": {
                "PrimaryValueDisplayType": "ACTUAL",
                "Comparison": { "ComparisonMethod": "DIFFERENCE" }
              }
            }
          }
        },
        {
          "PieChartVisual": {
            "VisualId": "vis-states",
            "Title": {
              "Visibility": "VISIBLE",
              "FormatText": { "PlainText": "Operational States" }
            },
            "ChartConfiguration": {
              "FieldWells": {
                "PieChartAggregatedFieldWells": {
                  "Category": [
                    {
                      "CategoricalDimensionField": {
                        "FieldId": "states.state",
                        "Column": {
                          "DataSetIdentifier": "wells",
                          "ColumnName": "state"
                        }
                      }
                    }
                  ],
                  "Values": [
                    {
                      "CategoricalMeasureField": {
                        "FieldId": "states.count",
                        "Column": {
                          "DataSetIdentifier": "wells",
                          "ColumnName": "state"
                        },
                        "AggregationFunction": "COUNT"
                      }
                    }
                  ]
                }
              }
            }
          }
        }
      ],
      "Layouts": [
        {
          "Configuration": {
            "GridLayout": {
              "Elements": [
                { "ElementId": "vis-decline-curve", "ElementType": "VISUAL",
                  "ColumnIndex": 0, "ColumnSpan": 18, "RowIndex": 0,  "RowSpan": 10 },
                { "ElementId": "vis-whp",           "ElementType": "VISUAL",
                  "ColumnIndex": 18,"ColumnSpan": 18, "RowIndex": 0,  "RowSpan": 10 },
                { "ElementId": "vis-total-prod",    "ElementType": "VISUAL",
                  "ColumnIndex": 0, "ColumnSpan": 12, "RowIndex": 10, "RowSpan": 8  },
                { "ElementId": "vis-states",        "ElementType": "VISUAL",
                  "ColumnIndex": 12,"ColumnSpan": 24, "RowIndex": 10, "RowSpan": 8  }
              ]
            }
          }
        }
      ]
    }
  ]
}
JSON

# -----------------------------------------------------------------------------
# 3. Create (or recreate) the analysis
# -----------------------------------------------------------------------------
if aws_qs describe-analysis \
     --aws-account-id "$AWS_ACCOUNT_ID" \
     --analysis-id "$ANALYSIS_ID" >/dev/null 2>&1; then
  echo "Analysis '$ANALYSIS_ID' already exists — updating."
  aws_qs update-analysis \
    --aws-account-id "$AWS_ACCOUNT_ID" \
    --analysis-id "$ANALYSIS_ID" \
    --name "$ANALYSIS_NAME" \
    --definition "file://$DEF_FILE"
else
  aws_qs create-analysis \
    --aws-account-id "$AWS_ACCOUNT_ID" \
    --analysis-id "$ANALYSIS_ID" \
    --name "$ANALYSIS_NAME" \
    --definition "file://$DEF_FILE" \
    --tags Key=project,Value=oil-gas-quicksight \
           Key=env,Value=dev \
           Key=owner,Value=habib.gramondi \
           Key=managed,Value=cli
fi

echo "Done. Open in console:"
echo "  https://${AWS_REGION}.quicksight.aws.amazon.com/sn/analyses/${ANALYSIS_ID}"
