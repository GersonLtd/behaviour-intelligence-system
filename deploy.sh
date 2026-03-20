#!/usr/bin/env bash
# ============================================================================
# Behaviour Intelligence System — BigQuery Deploy Script
# ============================================================================
# Deploys the full SQL pipeline to BigQuery:
#   1. Signal scores         → materialised table
#   2. State classification  → materialised table
#   3. Temporal analysis     → materialised table
#   4. Taxonomy audit        → runs as query (no table created)
#   5. Dashboard views       → creates/replaces views
#   6. Validation queries    → runs as verification checks
#
# Usage:
#   ./deploy.sh --project=my-gcp-project --dataset=bi_system --ga4-dataset=analytics_123456
#
# Prerequisites:
#   - gcloud CLI installed and authenticated
#   - BigQuery API enabled on the target project
#   - GA4 BigQuery export enabled and flowing data
#
# Production scheduling:
#   This script is intended for initial deployment and ad-hoc runs.
#   For daily incremental processing in production, use one of:
#     - BigQuery Scheduled Queries (simplest — native to GCP)
#     - dbt (if you need version-controlled transformations)
#     - Cloud Composer / Airflow (if part of a larger pipeline)
# ============================================================================

set -euo pipefail

# ─── Defaults ────────────────────────────────────────────────────────────────

PROJECT=""
DATASET=""
GA4_DATASET=""
LOCATION="US"
MODE="full"
DRY_RUN=false
SKIP_VALIDATION=false

# ─── Parse arguments ─────────────────────────────────────────────────────────

usage() {
  cat <<EOF
Usage: ./deploy.sh --project=PROJECT --dataset=DATASET --ga4-dataset=GA4_DATASET [options]

Required:
  --project=PROJECT         GCP project ID (e.g. my-analytics-project)
  --dataset=DATASET         BigQuery dataset for output tables/views (e.g. bi_system)
  --ga4-dataset=GA4_DATASET BigQuery dataset for GA4 export (e.g. analytics_123456789)

Options:
  --location=LOCATION       BigQuery dataset location (default: US)
  --mode=MODE               "full" (default) rebuilds all tables from 30-day window.
                            "incremental" processes yesterday only via MERGE (cheaper).
                            Use "full" for first deploy, "incremental" for daily runs.
  --dry-run                 Show substituted SQL without executing
  --skip-validation         Skip step 6 (validation queries)
  --help                    Show this help message

Examples:
  ./deploy.sh --project=acme-analytics --dataset=behaviour_intel --ga4-dataset=analytics_301234567
  ./deploy.sh --project=acme-analytics --dataset=behaviour_intel --ga4-dataset=analytics_301234567 --mode=incremental
  ./deploy.sh --project=acme-analytics --dataset=behaviour_intel --ga4-dataset=analytics_301234567 --dry-run
EOF
  exit 1
}

for arg in "$@"; do
  case "$arg" in
    --project=*)       PROJECT="${arg#*=}" ;;
    --dataset=*)       DATASET="${arg#*=}" ;;
    --ga4-dataset=*)   GA4_DATASET="${arg#*=}" ;;
    --location=*)      LOCATION="${arg#*=}" ;;
    --mode=*)          MODE="${arg#*=}" ;;
    --dry-run)         DRY_RUN=true ;;
    --skip-validation) SKIP_VALIDATION=true ;;
    --help)            usage ;;
    *)                 echo "Unknown argument: $arg"; usage ;;
  esac
done

if [[ -z "$PROJECT" || -z "$DATASET" || -z "$GA4_DATASET" ]]; then
  echo "Error: --project, --dataset, and --ga4-dataset are all required."
  echo ""
  usage
fi

if [[ "$MODE" != "full" && "$MODE" != "incremental" ]]; then
  echo "Error: --mode must be 'full' or 'incremental' (got '$MODE')"
  exit 1
fi

# ─── Preflight checks ───────────────────────────────────────────────────────

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SQL_DIR="$SCRIPT_DIR/sql"

if ! command -v bq &> /dev/null; then
  echo "Error: 'bq' command not found."
  echo ""
  echo "Install the Google Cloud CLI: https://cloud.google.com/sdk/docs/install"
  echo "Then run: gcloud auth application-default login"
  exit 1
fi

if [[ ! -d "$SQL_DIR" ]]; then
  echo "Error: sql/ directory not found at $SQL_DIR"
  exit 1
fi

# Verify all SQL files exist
REQUIRED_SQL="01-signal-scores.sql 02-state-classification.sql 03-temporal-analysis.sql
04-taxonomy-audit.sql 05-dashboard-views.sql 06-validation-queries.sql"
if [[ "$MODE" == "incremental" ]]; then
  REQUIRED_SQL="$REQUIRED_SQL 01-signal-scores-incremental.sql
02-state-classification-incremental.sql 03-temporal-analysis-incremental.sql"
fi
for f in $REQUIRED_SQL; do
  if [[ ! -f "$SQL_DIR/$f" ]]; then
    echo "Error: Missing $SQL_DIR/$f"
    exit 1
  fi
done

echo "============================================"
echo "Behaviour Intelligence System — Deploy"
echo "============================================"
echo "Project:      $PROJECT"
echo "Dataset:      $DATASET"
echo "GA4 dataset:  $GA4_DATASET"
echo "Location:     $LOCATION"
echo "Mode:         $MODE"
echo "Dry run:      $DRY_RUN"
echo "============================================"
echo ""

# ─── Helpers ─────────────────────────────────────────────────────────────────

# Temp directory for SQL files (cleaned up on exit)
TMPDIR_DEPLOY=$(mktemp -d)
trap 'rm -rf "$TMPDIR_DEPLOY"' EXIT

# Substitute all placeholders in a SQL file
substitute() {
  local file="$1"
  sed \
    -e "s|your-project|$PROJECT|g" \
    -e "s|your_dataset|$DATASET|g" \
    -e "s|analytics_123456|$GA4_DATASET|g" \
    "$file"
}

# Write SQL to a temp file and run via bq query.
# Uses a temp file instead of a positional argument to handle multi-statement
# SQL (e.g. multiple CREATE VIEW statements) and avoid shell quoting issues
# with large queries containing backticks.
run_query() {
  local label="$1"
  local sql="$2"

  if [[ "$DRY_RUN" == true ]]; then
    echo "── $label (dry run) ──"
    echo "$sql"
    echo ""
    return 0
  fi

  local tmpfile="$TMPDIR_DEPLOY/query.sql"
  echo "$sql" > "$tmpfile"

  echo -n "  $label ... "
  if bq query \
    --project_id="$PROJECT" \
    --use_legacy_sql=false \
    --max_rows=0 \
    < "$tmpfile" > /dev/null 2>&1; then
    echo "OK"
    return 0
  else
    echo "FAILED"
    return 1
  fi
}

# Run a query and materialise the result as a table (CREATE OR REPLACE TABLE)
materialise() {
  local label="$1"
  local table="$2"
  local sql="$3"

  local wrapped="CREATE OR REPLACE TABLE \`$PROJECT.$DATASET.$table\` AS
$sql"

  if [[ "$DRY_RUN" == true ]]; then
    echo "── $label → $DATASET.$table (dry run) ──"
    echo "$wrapped"
    echo ""
    return 0
  fi

  local tmpfile="$TMPDIR_DEPLOY/materialise.sql"
  echo "$wrapped" > "$tmpfile"

  echo -n "  $label → $DATASET.$table ... "
  if bq query \
    --project_id="$PROJECT" \
    --use_legacy_sql=false \
    --max_rows=0 \
    < "$tmpfile" > /dev/null 2>&1; then
    echo "OK"
    return 0
  else
    echo "FAILED"
    return 1
  fi
}

# ─── Ensure dataset exists ───────────────────────────────────────────────────

if [[ "$DRY_RUN" == false ]]; then
  echo -n "  Ensuring dataset $DATASET exists ... "
  if bq show --project_id="$PROJECT" "$DATASET" > /dev/null 2>&1; then
    echo "OK (exists)"
  else
    if bq mk --project_id="$PROJECT" --location="$LOCATION" --dataset "$DATASET" > /dev/null 2>&1; then
      echo "OK (created)"
    else
      echo "FAILED"
      echo "Could not create dataset $DATASET. Check permissions."
      exit 1
    fi
  fi
  echo ""
fi

# ─── Step 1: Signal scores ──────────────────────────────────────────────────

ERRORS=0

echo "Step 1/6: Signal scores"
if [[ "$MODE" == "incremental" ]]; then
  SQL_01=$(substitute "$SQL_DIR/01-signal-scores-incremental.sql")
  run_query "Merging signal scores (incremental)" "$SQL_01" || ((ERRORS++))
else
  SQL_01=$(substitute "$SQL_DIR/01-signal-scores.sql")
  materialise "Calculating signal scores" "signal_scores" "$SQL_01" || ((ERRORS++))
fi
echo ""

# ─── Step 2: State classification ────────────────────────────────────────────

echo "Step 2/6: State classification"
if [[ "$MODE" == "incremental" ]]; then
  SQL_02=$(substitute "$SQL_DIR/02-state-classification-incremental.sql")
  run_query "Merging classified sessions (incremental)" "$SQL_02" || ((ERRORS++))
else
  SQL_02=$(substitute "$SQL_DIR/02-state-classification.sql")
  materialise "Classifying sessions" "classified_sessions" "$SQL_02" || ((ERRORS++))
fi
echo ""

# ─── Step 3: Temporal analysis ───────────────────────────────────────────────

echo "Step 3/6: Temporal analysis"
if [[ "$MODE" == "incremental" ]]; then
  SQL_03=$(substitute "$SQL_DIR/03-temporal-analysis-incremental.sql")
  run_query "Merging temporal analysis (incremental)" "$SQL_03" || ((ERRORS++))
else
  SQL_03=$(substitute "$SQL_DIR/03-temporal-analysis.sql")
  materialise "Analysing temporal patterns" "temporal_analysis" "$SQL_03" || ((ERRORS++))
fi
echo ""

# ─── Step 4: Taxonomy audit ──────────────────────────────────────────────────

echo "Step 4/6: Taxonomy audit"
SQL_04=$(substitute "$SQL_DIR/04-taxonomy-audit.sql")
if [[ "$DRY_RUN" == true ]]; then
  echo "── Taxonomy audit (dry run) ──"
  echo "$SQL_04"
  echo ""
else
  local_tmpfile="$TMPDIR_DEPLOY/audit.sql"
  echo "$SQL_04" > "$local_tmpfile"
  echo -n "  Running taxonomy audit ... "
  AUDIT_OUTPUT=$(bq query \
    --project_id="$PROJECT" \
    --use_legacy_sql=false \
    --format=prettyjson \
    --max_rows=20 \
    < "$local_tmpfile" 2>&1) && {
    echo "OK"
    if [[ -n "$AUDIT_OUTPUT" && "$AUDIT_OUTPUT" != "[]" ]]; then
      echo ""
      echo "  Untagged high-traffic pages found:"
      echo "$AUDIT_OUTPUT" | head -40
      echo ""
      echo "  Review these pages and add taxonomy metadata."
    else
      echo "  No untagged high-traffic pages found."
    fi
  } || {
    echo "FAILED (non-critical — audit query only)"
  }
fi
echo ""

# ─── Step 5: Dashboard views ────────────────────────────────────────────────

echo "Step 5/6: Dashboard views"
SQL_05=$(substitute "$SQL_DIR/05-dashboard-views.sql")

# 05-dashboard-views.sql contains multiple CREATE OR REPLACE VIEW statements.
# These must be executed as-is (not wrapped), since they're already DDL.
run_query "Creating dashboard views" "$SQL_05" || ((ERRORS++))
echo ""

# ─── Step 6: Validation ─────────────────────────────────────────────────────

if [[ "$SKIP_VALIDATION" == true ]]; then
  echo "Step 6/6: Validation (skipped)"
else
  echo "Step 6/6: Validation"
  SQL_06=$(substitute "$SQL_DIR/06-validation-queries.sql")

  if [[ "$DRY_RUN" == true ]]; then
    echo "── Validation queries (dry run) ──"
    echo "$SQL_06"
    echo ""
  else
    local_tmpfile="$TMPDIR_DEPLOY/validation.sql"
    echo "$SQL_06" > "$local_tmpfile"
    echo -n "  Running validation checks ... "
    VALIDATION_OUTPUT=$(bq query \
      --project_id="$PROJECT" \
      --use_legacy_sql=false \
      --format=pretty \
      --max_rows=50 \
      < "$local_tmpfile" 2>&1) && {
      echo "OK"
      if [[ -n "$VALIDATION_OUTPUT" ]]; then
        echo ""
        echo "$VALIDATION_OUTPUT"
      fi
    } || {
      echo "FAILED"
      if [[ -n "$VALIDATION_OUTPUT" ]]; then
        echo ""
        echo "$VALIDATION_OUTPUT"
      fi
      ((ERRORS++))
    }
  fi
fi
echo ""

# ─── Summary ─────────────────────────────────────────────────────────────────

echo "============================================"
if [[ "$DRY_RUN" == true ]]; then
  echo "Dry run complete. No queries were executed."
elif [[ $ERRORS -eq 0 ]]; then
  echo "Deploy complete. All steps passed."
  echo ""
  echo "Tables created:"
  echo "  $PROJECT.$DATASET.signal_scores"
  echo "  $PROJECT.$DATASET.classified_sessions"
  echo "  $PROJECT.$DATASET.temporal_analysis"
  echo ""
  echo "Views created:"
  echo "  $PROJECT.$DATASET.combined_sessions"
  echo "  $PROJECT.$DATASET.dashboard_state_distribution"
  echo "  $PROJECT.$DATASET.dashboard_conversion_by_state"
  echo "  $PROJECT.$DATASET.dashboard_state_transitions"
  echo "  $PROJECT.$DATASET.dashboard_source_quality"
  echo "  $PROJECT.$DATASET.dashboard_confidence_distribution"
  echo "  $PROJECT.$DATASET.dashboard_problem_view"
  echo "  $PROJECT.$DATASET.dashboard_taxonomy_health"
  echo "  $PROJECT.$DATASET.dashboard_prescriptive"
  echo ""
  echo "Next steps:"
  if [[ "$MODE" == "full" ]]; then
    echo "  1. Review taxonomy audit output above (if any untagged pages)"
    echo "  2. Connect Looker Studio to the dashboard_* views"
    echo "  3. Schedule daily runs with --mode=incremental to reduce costs"
  else
    echo "  1. Review taxonomy audit output above (if any untagged pages)"
    echo "  2. Incremental MERGE complete — dashboard views read from updated tables"
  fi
else
  echo "Deploy completed with $ERRORS error(s). Review output above."
fi
echo "============================================"

exit $ERRORS
